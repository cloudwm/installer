import os
import json
import subprocess
import threading
import time
import uuid
import base64
import functools
import collections
from pathlib import Path
from flask import (
    Flask, jsonify, request, render_template,
    send_from_directory, Response, redirect, url_for, session
)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024
app.secret_key = os.environ.get("SECRET_KEY", "change-me-in-env")

EMULATOR_DATA = os.environ.get("EMULATOR_DATA", "/opt/android-emulator/emulators")
FARM_DIR = os.environ.get("FARM_DIR", "/opt/android-emulator")
PUBLIC_IP = os.environ.get("PUBLIC_IP", "0.0.0.0")
UPLOAD_DIR = "/app/uploads"
AUTH_USER = os.environ.get("AUTH_USER", "admin")
AUTH_PASS = os.environ.get("AUTH_PASS", "admin")
EMU_RAM_MB = 2048

tasks = {}
tasks_lock = threading.Lock()

# Metrics history: circular buffer of {timestamp, mem_used, mem_total, swap_used, cpu_percent}
metrics_history = collections.deque(maxlen=360)  # 1h at 10s intervals
metrics_lock = threading.Lock()

ANDROID_VERSIONS = [
    {"version": "9.0", "api": 28, "image": "budtmo/docker-android:emulator_9.0"},
    {"version": "10.0", "api": 29, "image": "budtmo/docker-android:emulator_10.0"},
    {"version": "11.0", "api": 30, "image": "budtmo/docker-android:emulator_11.0"},
    {"version": "12.0", "api": 32, "image": "budtmo/docker-android:emulator_12.0"},
    {"version": "13.0", "api": 33, "image": "budtmo/docker-android:emulator_13.0"},
    {"version": "14.0", "api": 34, "image": "budtmo/docker-android:emulator_14.0"},
]

RESOLUTIONS = [
    {"resolution": "1080x1920", "dpi": "480", "label": "Full HD (1080x1920)"},
    {"resolution": "1440x2560", "dpi": "560", "label": "QHD (1440x2560)"},
    {"resolution": "720x1280", "dpi": "320", "label": "HD (720x1280)"},
    {"resolution": "480x800", "dpi": "240", "label": "WVGA (480x800)"},
    {"resolution": "1080x2340", "dpi": "420", "label": "Modern 19.5:9 (1080x2340)"},
    {"resolution": "800x1280", "dpi": "213", "label": "Tablet 7\" (800x1280)"},
    {"resolution": "1200x1920", "dpi": "240", "label": "Tablet 10\" (1200x1920)"},
]

DEVICES = [
    {"name": "Samsung Galaxy S10", "type": "Phone"},
    {"name": "Samsung Galaxy S9", "type": "Phone"},
    {"name": "Samsung Galaxy S8", "type": "Phone"},
    {"name": "Samsung Galaxy S7 Edge", "type": "Phone"},
    {"name": "Samsung Galaxy S7", "type": "Phone"},
    {"name": "Samsung Galaxy S6", "type": "Phone"},
    {"name": "Nexus 4", "type": "Phone"},
    {"name": "Nexus 5", "type": "Phone"},
    {"name": "Nexus One", "type": "Phone"},
    {"name": "Nexus S", "type": "Phone"},
    {"name": "Nexus 7", "type": "Tablet"},
    {"name": "Pixel C", "type": "Tablet"},
]

Path(EMULATOR_DATA).mkdir(parents=True, exist_ok=True)
Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


# ─── Auth ─────────────────────────────────────────────────────────────────────

def login_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect("/login")
        return f(*args, **kwargs)
    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        data = request.form if request.form else (request.json or {})
        if data.get("username") == AUTH_USER and data.get("password") == AUTH_PASS:
            session["logged_in"] = True
            return redirect("/")
        return render_template("login.html", error="Invalid credentials", public_ip=PUBLIC_IP)
    return render_template("login.html", error=None, public_ip=PUBLIC_IP)


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def run_cmd(cmd, timeout=30):
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", "Command timed out", 1


def adb_cmd(name, cmd, timeout=15):
    return run_cmd(f"docker exec android-{name} adb {cmd}", timeout=timeout)


def read_meminfo():
    try:
        with open("/host_proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])
        total = info.get("MemTotal", 0) // 1024
        free = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
        swap_total = info.get("SwapTotal", 0) // 1024
        swap_free = info.get("SwapFree", 0) // 1024
        return total, total - free, free, swap_total, swap_total - swap_free, swap_free
    except Exception:
        return 0, 0, 0, 0, 0, 0


def get_emulators():
    emulators = []
    data_path = Path(EMULATOR_DATA)
    for f in sorted(data_path.glob("*.json")):
        try:
            with open(f) as fh:
                emu = json.load(fh)
            container_name = f"android-{emu['name']}"
            stdout, _, _ = run_cmd(
                f"docker inspect -f '{{{{.State.Status}}}}' {container_name} 2>/dev/null"
            )
            emu["status"] = stdout if stdout else "not created"

            if emu["status"] == "running":
                # Check QEMU process alive
                qemu_out, _, _ = run_cmd(
                    f"docker exec android-{emu['name']} pgrep -x qemu-system-x86 2>/dev/null", timeout=5
                )
                if not qemu_out:
                    emu["health"] = "starting"
                else:
                    boot_out, _, _ = adb_cmd(emu["name"], "shell getprop sys.boot_completed", timeout=3)
                    if boot_out.strip() == "1":
                        emu["health"] = "ready"
                    else:
                        emu["health"] = "booting"
            else:
                emu["health"] = "stopped"

            emu["boot_completed"] = emu["health"] == "ready"
            emu["novnc_url"] = f"http://{PUBLIC_IP}:{emu['novnc_port']}"
            emulators.append(emu)
        except (json.JSONDecodeError, KeyError):
            continue
    return emulators


def get_next_port(field, base):
    used = set()
    for f in Path(EMULATOR_DATA).glob("*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            used.add(data.get(field, 0))
        except (json.JSONDecodeError, KeyError):
            continue
    port = base
    while port in used:
        port += 1
    return port


def generate_compose():
    compose_path = os.path.join(FARM_DIR, "docker-compose.emulators.yml")
    emulators = get_emulators()

    lines = ["services:"]

    if not emulators:
        lines.append("  placeholder:")
        lines.append("    image: alpine:latest")
        lines.append("    command: 'true'")
    else:
        for emu in emulators:
            device = emu.get("device", "Samsung Galaxy S10")
            res_parts = emu["resolution"].split("x")
            emu_w, emu_h = int(res_parts[0]), int(res_parts[1])
            screen_w = emu_w + 200
            screen_h = emu_h + 500
            lines.append(f"  android-{emu['name']}:")
            lines.append(f"    image: {emu['image']}")
            lines.append(f"    container_name: android-{emu['name']}")
            lines.append("    restart: unless-stopped")
            lines.append("    privileged: true")
            lines.append("    devices:")
            lines.append("      - /dev/kvm")
            lines.append("    environment:")
            lines.append(f"      - EMULATOR_DEVICE={device}")
            lines.append("      - WEB_VNC=true")
            lines.append("      - WEB_LOG=true")
            lines.append(f"      - EMULATOR_SCREEN_RESOLUTION={emu['resolution']}")
            lines.append(f"      - EMULATOR_DPI={emu['dpi']}")
            lines.append(f"      - SCREEN_WIDTH={screen_w}")
            lines.append(f"      - SCREEN_HEIGHT={screen_h}")
            lines.append(f"      - SCREEN_DEPTH=24")
            lines.append("      - DATAPARTITION=2g")
            lines.append("      - ADB_INSECURE=1")
            lines.append(
                f"      - EMULATOR_ADDITIONAL_ARGS=-memory {EMU_RAM_MB} -no-snapshot -no-boot-anim -no-audio"
            )
            lines.append("    ports:")
            lines.append(f"      - \"{emu['novnc_port']}:6080\"")
            lines.append(f"      - \"{emu['adb_port']}:5555\"")
            lines.append("    volumes:")
            lines.append(f"      - android-data-{emu['name']}:/root/.android")
            lines.append(f"      - {FARM_DIR}/set-black-bg.conf:/etc/supervisor/conf.d/set-black-bg.conf:ro")
            lines.append("    networks:")
            lines.append("      - farm-network")
            lines.append("")

        lines.append("volumes:")
        for emu in emulators:
            lines.append(f"  android-data-{emu['name']}:")

    lines.append("")
    lines.append("networks:")
    lines.append("  farm-network:")
    lines.append("    external: true")
    lines.append("    name: android-emulator_farm-network")
    lines.append("")

    with open(compose_path, "w") as f:
        f.write("\n".join(lines))


# ─── Task tracking ────────────────────────────────────────────────────────────

def create_task(name, action):
    task_id = str(uuid.uuid4())[:8]
    with tasks_lock:
        tasks[task_id] = {
            "id": task_id, "name": name, "action": action,
            "status": "running", "message": f"{action.title()}ing '{name}'...",
            "started": time.time(), "finished": None,
        }
    return task_id


def finish_task(task_id, success, message):
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id]["status"] = "done" if success else "error"
            tasks[task_id]["message"] = message
            tasks[task_id]["finished"] = time.time()


# ─── Metrics collector (background thread) ────────────────────────────────────

def collect_metrics():
    while True:
        try:
            total, used, free, sw_total, sw_used, sw_free = read_meminfo()
            # CPU usage from /proc/stat
            cpu_pct = 0
            try:
                with open("/host_proc/stat") as f:
                    line = f.readline()
                parts = line.split()
                idle1 = int(parts[4])
                total1 = sum(int(x) for x in parts[1:])
                time.sleep(1)
                with open("/host_proc/stat") as f:
                    line = f.readline()
                parts = line.split()
                idle2 = int(parts[4])
                total2 = sum(int(x) for x in parts[1:])
                if total2 - total1 > 0:
                    cpu_pct = round(100 * (1 - (idle2 - idle1) / (total2 - total1)), 1)
            except Exception:
                pass

            with metrics_lock:
                metrics_history.append({
                    "t": int(time.time()),
                    "mem_used": used, "mem_total": total,
                    "swap_used": sw_used,
                    "cpu": cpu_pct,
                })
        except Exception:
            pass
        time.sleep(9)

threading.Thread(target=collect_metrics, daemon=True).start()


# ─── Routes: Pages ────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def index():
    return render_template("index.html", public_ip=PUBLIC_IP)


# ─── Routes: Emulator CRUD ───────────────────────────────────────────────────

@app.route("/api/emulators", methods=["GET"])
@login_required
def api_list_emulators():
    return jsonify(get_emulators())


@app.route("/api/emulators", methods=["POST"])
@login_required
def api_create_emulator():
    data = request.json
    name = data.get("name", "").strip()
    version = data.get("version", "11.0")
    resolution = data.get("resolution", "1080x1920")
    device = data.get("device", "Samsung Galaxy S10")
    dpi = data.get("dpi", "")

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not name.replace("-", "").replace("_", "").isalnum():
        return jsonify({"error": "Name must be alphanumeric (hyphens/underscores allowed)"}), 400

    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' already exists"}), 409

    image = None
    for v in ANDROID_VERSIONS:
        if v["version"] == version:
            image = v["image"]
            break
    if not image:
        return jsonify({"error": f"Unsupported version: {version}"}), 400

    if not dpi:
        for r in RESOLUTIONS:
            if r["resolution"] == resolution:
                dpi = r["dpi"]
                break
        if not dpi:
            dpi = "480"

    novnc_port = get_next_port("novnc_port", 6080)
    adb_port = get_next_port("adb_port", 5555)

    emu_data = {
        "name": name, "version": version, "resolution": resolution,
        "dpi": dpi, "device": device, "image": image,
        "novnc_port": novnc_port, "adb_port": adb_port,
        "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    with open(emu_file, "w") as f:
        json.dump(emu_data, f, indent=2)

    generate_compose()
    return jsonify({"ok": True, "emulator": emu_data}), 201


@app.route("/api/emulators/<name>", methods=["PUT"])
@login_required
def api_edit_emulator(name):
    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if not emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' not found"}), 404

    with open(emu_file) as fh:
        emu = json.load(fh)

    data = request.json or {}
    changed = False

    if "version" in data and data["version"] != emu.get("version"):
        new_img = None
        for v in ANDROID_VERSIONS:
            if v["version"] == data["version"]:
                new_img = v["image"]
                break
        if not new_img:
            return jsonify({"error": "Unsupported version"}), 400
        emu["version"] = data["version"]
        emu["image"] = new_img
        changed = True

    if "resolution" in data and data["resolution"] != emu.get("resolution"):
        emu["resolution"] = data["resolution"]
        for r in RESOLUTIONS:
            if r["resolution"] == data["resolution"]:
                emu["dpi"] = r["dpi"]
                break
        changed = True

    if "device" in data and data["device"] != emu.get("device"):
        emu["device"] = data["device"]
        changed = True

    if not changed:
        return jsonify({"ok": True, "message": "No changes"})

    with open(emu_file, "w") as f:
        json.dump(emu, f, indent=2)

    generate_compose()

    # Need to recreate container for changes to take effect
    return jsonify({
        "ok": True,
        "message": f"Settings updated. Restart '{name}' for changes to take effect.",
        "needs_restart": True,
    })


@app.route("/api/emulators/<name>", methods=["DELETE"])
@login_required
def api_delete_emulator(name):
    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if not emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' not found"}), 404

    task_id = create_task(name, "delete")

    def do_delete():
        try:
            run_cmd(f"docker stop android-{name} 2>/dev/null; docker rm android-{name} 2>/dev/null", timeout=60)
            emu_file.unlink(missing_ok=True)
            generate_compose()
            finish_task(task_id, True, f"Emulator '{name}' deleted")
        except Exception as e:
            finish_task(task_id, False, str(e))

    threading.Thread(target=do_delete, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": f"Deleting '{name}'..."})


@app.route("/api/emulators/<name>/start", methods=["POST"])
@login_required
def api_start_emulator(name):
    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if not emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' not found"}), 404

    # Resource check
    _, _, free_mb, _, _, _ = read_meminfo()
    if free_mb < EMU_RAM_MB:
        return jsonify({
            "error": f"Not enough free RAM ({free_mb} MB free, {EMU_RAM_MB} MB needed). Stop another emulator first.",
            "warning": True,
        }), 400

    task_id = create_task(name, "start")

    def do_start():
        try:
            generate_compose()
            stdout, stderr, code = run_cmd(
                f"cd {FARM_DIR} && docker compose -f docker-compose.emulators.yml up -d android-{name}",
                timeout=600,
            )
            if code != 0:
                finish_task(task_id, False, stderr or "Failed to start")
                return
            finish_task(task_id, True, f"Emulator '{name}' started. Android is booting...")
        except Exception as e:
            finish_task(task_id, False, str(e))

    threading.Thread(target=do_start, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": f"Starting '{name}'..."})


@app.route("/api/emulators/<name>/stop", methods=["POST"])
@login_required
def api_stop_emulator(name):
    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if not emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' not found"}), 404
    task_id = create_task(name, "stop")
    def do_stop():
        try:
            run_cmd(f"docker stop android-{name}", timeout=60)
            finish_task(task_id, True, f"Emulator '{name}' stopped")
        except Exception as e:
            finish_task(task_id, False, str(e))
    threading.Thread(target=do_stop, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": f"Stopping '{name}'..."})


@app.route("/api/emulators/<name>/restart", methods=["POST"])
@login_required
def api_restart_emulator(name):
    emu_file = Path(EMULATOR_DATA) / f"{name}.json"
    if not emu_file.exists():
        return jsonify({"error": f"Emulator '{name}' not found"}), 404
    task_id = create_task(name, "restart")
    def do_restart():
        try:
            run_cmd(f"docker stop android-{name} 2>/dev/null", timeout=60)
            run_cmd(f"docker rm android-{name} 2>/dev/null", timeout=10)
            generate_compose()
            run_cmd(
                f"cd {FARM_DIR} && docker compose -f docker-compose.emulators.yml up -d android-{name}",
                timeout=600,
            )
            finish_task(task_id, True, f"Emulator '{name}' restarted. Android is booting...")
        except Exception as e:
            finish_task(task_id, False, str(e))
    threading.Thread(target=do_restart, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": f"Restarting '{name}'..."})


# ─── Routes: Logs ─────────────────────────────────────────────────────────────

@app.route("/api/emulators/<name>/logs", methods=["GET"])
@login_required
def api_logs(name):
    lines = request.args.get("lines", "100")
    stdout, stderr, code = run_cmd(f"docker logs --tail {lines} android-{name} 2>&1", timeout=10)
    return jsonify({"ok": True, "logs": stdout or stderr})


# ─── Routes: Thumbnail ───────────────────────────────────────────────────────

@app.route("/api/emulators/<name>/thumbnail", methods=["GET"])
@login_required
def api_thumbnail(name):
    stdout, stderr, code = run_cmd(
        f"docker exec android-{name} adb exec-out screencap -p 2>/dev/null | base64",
        timeout=8,
    )
    if code != 0 or not stdout:
        return jsonify({"ok": False}), 404
    return jsonify({"ok": True, "image": stdout})


# ─── Routes: Device actions ───────────────────────────────────────────────────

@app.route("/api/emulators/<name>/screenshot", methods=["GET"])
@login_required
def api_screenshot(name):
    stdout, stderr, code = run_cmd(
        f"docker exec android-{name} adb exec-out screencap -p | base64", timeout=15,
    )
    if code != 0 or not stdout:
        return jsonify({"error": stderr or "Failed to capture screenshot"}), 500
    return jsonify({"ok": True, "image": stdout})


@app.route("/api/emulators/<name>/install-apk", methods=["POST"])
@login_required
def api_install_apk(name):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    apk = request.files["file"]
    if not apk.filename.endswith(".apk"):
        return jsonify({"error": "File must be an APK"}), 400

    filename = f"{uuid.uuid4().hex}.apk"
    local_path = os.path.join(UPLOAD_DIR, filename)
    apk.save(local_path)
    task_id = create_task(name, "install")

    def do_install():
        try:
            cp_out, cp_err, cp_code = run_cmd(
                f"docker cp {local_path} android-{name}:/tmp/{filename}", timeout=60
            )
            if cp_code != 0:
                finish_task(task_id, False, cp_err or "Failed to copy APK"); return
            out, err, code = adb_cmd(name, f"install -r /tmp/{filename}", timeout=120)
            os.remove(local_path)
            run_cmd(f"docker exec android-{name} rm /tmp/{filename}", timeout=5)
            if code != 0 or "Success" not in (out + err):
                finish_task(task_id, False, err or out or "Install failed")
            else:
                finish_task(task_id, True, f"APK installed on '{name}'")
        except Exception as e:
            finish_task(task_id, False, str(e))

    threading.Thread(target=do_install, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": "Installing APK..."})


@app.route("/api/emulators/<name>/push-file", methods=["POST"])
@login_required
def api_push_file(name):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    dest = request.form.get("destination", "/sdcard/")
    filename = f.filename
    local_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    f.save(local_path)
    task_id = create_task(name, "upload")

    def do_push():
        try:
            run_cmd(f"docker cp {local_path} android-{name}:/tmp/{filename}", timeout=60)
            out, err, code = adb_cmd(name, f"push /tmp/{filename} {dest}{filename}", timeout=60)
            os.remove(local_path)
            run_cmd(f"docker exec android-{name} rm /tmp/{filename}", timeout=5)
            if code != 0:
                finish_task(task_id, False, err or "Push failed")
            else:
                finish_task(task_id, True, f"File '{filename}' pushed to {dest}")
        except Exception as e:
            finish_task(task_id, False, str(e))

    threading.Thread(target=do_push, daemon=True).start()
    return jsonify({"ok": True, "task_id": task_id, "message": f"Uploading '{filename}'..."})


@app.route("/api/emulators/<name>/clipboard", methods=["GET"])
@login_required
def api_get_clipboard(name):
    out, err, code = adb_cmd(name, "shell cmd clipboard get-primary-clip 2>/dev/null", timeout=10)
    return jsonify({"ok": True, "text": out})


@app.route("/api/emulators/<name>/clipboard", methods=["POST"])
@login_required
def api_set_clipboard(name):
    data = request.json or {}
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "No text provided"}), 400
    safe_text = text.replace("'", "'\\''")
    out, err, code = adb_cmd(name, f"shell am broadcast -a clipper.set -e text '{safe_text}'", timeout=10)
    if code != 0:
        adb_cmd(name, f"shell input text '{safe_text}'", timeout=10)
    return jsonify({"ok": True, "message": "Clipboard set"})


@app.route("/api/emulators/<name>/shell", methods=["POST"])
@login_required
def api_shell(name):
    data = request.json or {}
    cmd = data.get("command", "").strip()
    if not cmd:
        return jsonify({"error": "No command provided"}), 400
    out, err, code = adb_cmd(name, f"shell {cmd}", timeout=30)
    return jsonify({"ok": True, "stdout": out, "stderr": err, "exit_code": code})


@app.route("/api/emulators/<name>/info", methods=["GET"])
@login_required
def api_device_info(name):
    props = {}
    for key in [
        "ro.build.version.release", "ro.build.version.sdk",
        "ro.product.model", "ro.product.brand",
        "ro.build.display.id", "ro.hardware",
        "persist.sys.timezone", "persist.sys.language",
        "gsm.operator.alpha",
    ]:
        out, _, _ = adb_cmd(name, f"shell getprop {key}", timeout=5)
        props[key] = out
    return jsonify({"ok": True, "properties": props})


@app.route("/api/emulators/<name>/apps", methods=["GET"])
@login_required
def api_list_apps(name):
    out, _, code = adb_cmd(name, "shell pm list packages -3", timeout=15)
    packages = []
    if code == 0 and out:
        packages = [line.replace("package:", "") for line in out.splitlines() if line.startswith("package:")]
    return jsonify({"ok": True, "packages": packages})


@app.route("/api/emulators/<name>/uninstall", methods=["POST"])
@login_required
def api_uninstall_app(name):
    data = request.json or {}
    package = data.get("package", "").strip()
    if not package:
        return jsonify({"error": "No package name provided"}), 400
    out, err, code = adb_cmd(name, f"uninstall {package}", timeout=30)
    if code != 0:
        return jsonify({"error": err or out or "Uninstall failed"}), 500
    return jsonify({"ok": True, "message": f"Uninstalled {package}"})


# ─── Routes: Metadata & System ───────────────────────────────────────────────

@app.route("/api/tasks", methods=["GET"])
@login_required
def api_tasks():
    with tasks_lock:
        now = time.time()
        active = {k: v for k, v in tasks.items() if now - v["started"] < 600}
    return jsonify(list(active.values()))


@app.route("/api/versions", methods=["GET"])
@login_required
def api_versions():
    return jsonify(ANDROID_VERSIONS)


@app.route("/api/resolutions", methods=["GET"])
@login_required
def api_resolutions():
    return jsonify(RESOLUTIONS)


@app.route("/api/devices", methods=["GET"])
@login_required
def api_devices():
    return jsonify(DEVICES)


@app.route("/api/system", methods=["GET"])
@login_required
def api_system():
    total, used, free, sw_total, sw_used, sw_free = read_meminfo()

    try:
        with open("/host_proc/cpuinfo") as f:
            cpus = sum(1 for line in f if line.startswith("processor"))
    except Exception:
        cpus = 0

    disk_out, _, _ = run_cmd("df -h /opt/android-emulator | awk 'NR==2{print $2,$3,$4,$5}'")
    disk_parts = disk_out.split() if disk_out else ["0", "0", "0", "0%"]

    # Count running emulators
    running_emus = 0
    for fp in Path(EMULATOR_DATA).glob("*.json"):
        try:
            with open(fp) as fh:
                d = json.load(fh)
            out, _, _ = run_cmd(f"docker inspect -f '{{{{.State.Status}}}}' android-{d['name']} 2>/dev/null", timeout=3)
            if out == "running":
                running_emus += 1
        except Exception:
            pass

    return jsonify({
        "memory": {"total": str(total), "used": str(used), "free": str(free)},
        "swap": {"total": str(sw_total), "used": str(sw_used), "free": str(sw_free)},
        "disk": {
            "total": disk_parts[0] if len(disk_parts) > 0 else "0",
            "used": disk_parts[1] if len(disk_parts) > 1 else "0",
            "free": disk_parts[2] if len(disk_parts) > 2 else "0",
            "percent": disk_parts[3] if len(disk_parts) > 3 else "0%",
        },
        "cpus": cpus,
        "public_ip": PUBLIC_IP,
        "running_emulators": running_emus,
        "emu_ram_mb": EMU_RAM_MB,
    })


@app.route("/api/metrics", methods=["GET"])
@login_required
def api_metrics():
    with metrics_lock:
        return jsonify(list(metrics_history))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
