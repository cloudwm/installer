#!/usr/bin/env bash
# install_omniroute.sh — installs the OmniRoute AI router as a systemd unit on the gateway.
# Run: bash install_omniroute.sh [--verify|--uninstall|flags]; run by the owner on the gateway.
# Note: mirrors install_suricata_ui.sh idioms; exit 0=service up / 1=refused / 2=degraded.

REV="2026-08-24.1"

# ---- constants ------------------------------------------------------------------------------- #
SCRIPT_LOG="/var/log/omniroute-install.log"
BACKUP_DIR="/opt/install_omniroute-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
# Absolute, so every path this script prints is one the reader can paste. ai/ask.sh lives beside it.
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

SERVICE_NAME="omniroute"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
MARKER_DIR="/etc/omniroute"
MARKER_FILE="$MARKER_DIR/installed"
LOGROTATE_FILE="/etc/logrotate.d/install-omniroute"
PROFILE_FILE="/etc/profile.d/omniroute.sh"
# 99z- so it sorts AFTER the gateway's own 99-suricata-gateway under LC_ALL=C ('-' 0x2D < 'z' 0x7A).
MOTD_FILE="/etc/update-motd.d/99z-omniroute"
ENV_FILE="$MARKER_DIR/omniroute.env"   # 0600, holds INITIAL_PASSWORD; never world-readable
# Written by ISO-Updates over SSH, never by this script; ai/ask.sh reads it. Named here so --verify
# and the login banner can point at it. See docs/rationale.md.
API_KEY_FILE="$MARKER_DIR/api.key"

# The login page ships this as unconditional UI text, so setting a password does not remove it.
# Stripped in flight by nginx (see install_nginx) rather than by patching the npm package.
HINT_EN='Default password: CHANGEME (unless INITIAL_PASSWORD was set)'

# The front door. Named omniroute-console so install_suricata.sh's remove_ui(), which deletes
# sites-*/suricata-ui, never matches it; see CLAUDE.md invariant 4 for the same trick.
NGX_SITE_AVAIL="/etc/nginx/sites-available/omniroute-console"
NGX_SITE_ENABLED="/etc/nginx/sites-enabled/omniroute-console"
TLS_DIR="/etc/ssl/omniroute-console"
DNS_DOMAIN="dev-cloud-xip.com"   # xip-style wildcard: 1-2-3-4.<domain> resolves to 1.2.3.4

NPM_PKG="omniroute"          # registry.npmjs.org/omniroute — provides bin/omniroute
# omniroute 3.8.49 declares engines node ">=22.22.2 <23 || >=24.0.0 <27". Ubuntu 26.04 ships
# nodejs 22.22.1 — one patch short — so NodeSource is the primary source. See docs in the plan.
NODE_MAJOR=24
NODE_MIN_MAJOR=22            # below this, omniroute's engine range cannot be satisfied at all
NODESOURCE_BASE="https://deb.nodesource.com/node_${NODE_MAJOR}.x"
NODESOURCE_KEY_URL="https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key"
NODESOURCE_KEYRING="/etc/apt/keyrings/nodesource.gpg"
NODESOURCE_LIST="/etc/apt/sources.list.d/nodesource.list"

# ---- derived / arg state --------------------------------------------------------------------- #
# Captured here: the arg loop shifts these away before setup_logging runs. Built from "$@" rather
# than "$*" so a --password value is masked whole — a quoted one joins into several tokens.
ARGV_RAW=""; _mask=no
for _a in "$@"; do
  [ "$_mask" = yes ] && { ARGV_RAW="$ARGV_RAW ***"; _mask=no; continue; }
  [ "$_a" = --password ] && _mask=yes
  ARGV_RAW="$ARGV_RAW $_a"
done
ARGV_RAW="${ARGV_RAW# }"; ARGV_RAW="${ARGV_RAW:-<none>}"; unset _a _mask
LOG_PID=""

VERIFY_ONLY=no
UNINSTALL=no
FULL_UNINSTALL=no      # --full-uninstall: also delete the logrotate policy, backups and the run log
NO_INSTALL=no          # --no-install: never touch apt/npm; refuse if a dependency is missing
OMNI_PASSWORD=""       # --password: never defaulted and never committed; see CLAUDE.md on secrets
OMNIROUTE_BIN=""       # --bin overrides the PATH lookup
NODE_BIN=""            # --node overrides the PATH lookup
NODE_DIR=""            # dirname of NODE_BIN — the whole reason the unit sets PATH
NPM_BIN=""             # resolved alongside node; npm's global prefix is how omniroute is found
UNIT_PATH=""           # the unit's Environment=PATH — verify asserts against this exact string
RUN_USER="root"
WORKDIR=""             # defaults to RUN_USER's home
RUN_HOME=""

TLS_PORT=9443          # --port: where nginx publishes the dashboard (the console owns 8443)
APP_PORT=20128         # --app-port: omniroute's own listener, proxied from loopback
PORTS_FROM_FLAGS=no    # an explicit --port/--app-port outranks whatever the marker recorded
WAN_IP=""              # --wan-ip; detected from the default route. Never the quarantine LAN.
HOSTNAME_FQDN=""       # --hostname; derived from WAN_IP
RENEW_CERT=no

CHANGED_ANY=no
PKGS_INSTALLED=no      # apt/npm installed something — so "nothing was changed" would be a lie
INSTALLED_NODE=no      # recorded in the marker: only --full-uninstall may remove what we installed
INSTALLED_OMNIROUTE=no

# ---- helpers --------------------------------------------------------------------------------- #
say()    { echo "omniroute: $*"; }
warn()   { echo "omniroute: WARNING — $*"; }
banner() { echo; echo "---- $* ----"; }

# stdout → console unchanged; a timestamped copy → $SCRIPT_LOG. Replaces `tee -a`, which cannot stamp.
log_pipe() {
  local line
  exec 3>>"$SCRIPT_LOG"
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line"
    printf '%(%H:%M:%S)T %s\n' -1 "$line" >&3
  done
}

# Bash can exit before the pump drains — that would drop exactly die()'s explanation from the file.
log_flush() { [ -n "$LOG_PID" ] || return 0; exec 1>&- 2>&-; wait "$LOG_PID" 2>/dev/null; }

# Every mode targets the Ubuntu gateway. --uninstall/--verify exit before preflight(), so this is
# the only thing between a laptop and a deleted systemd unit. Deep OS checks stay in preflight().
require_platform() {
  [ "$(uname -s)" = Linux ] \
    || { echo "omniroute: REFUSING: this targets the Ubuntu gateway; this host is $(uname -s)." >&2; exit 1; }
  [ "$(( ${BASH_VERSINFO[0]:-0} * 100 + ${BASH_VERSINFO[1]:-0} ))" -ge 402 ] \
    || { echo "omniroute: REFUSING: needs bash >= 4.2 for the timestamped log (found ${BASH_VERSION:-unknown})." >&2; exit 1; }
}

# The dashboard is published on the WAN, never the quarantine LAN. The WAN is the default-route
# interface, and `ip route get` reports the source address the kernel picks for it.
detect_wan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1
}

ip_to_host() { echo "${1//./-}.$DNS_DOMAIN"; }

# No "first global address" fallback: on a two-NIC gateway that would pick the quarantine LAN.
resolve_identity() {
  [ -n "$WAN_IP" ] || WAN_IP="$(detect_wan_ip)"
  [ -n "$WAN_IP" ] || die "could not detect a WAN IP (no default route?). Pass --wan-ip <addr>."
  case "$WAN_IP" in
    *[!0-9.]*) die "WAN IP '$WAN_IP' is not a dotted quad. Pass --wan-ip <addr>." ;;
    *.*.*.*)   : ;;
    *)         die "WAN IP '$WAN_IP' is not a dotted quad. Pass --wan-ip <addr>." ;;
  esac
  [ -n "$HOSTNAME_FQDN" ] || HOSTNAME_FQDN="$(ip_to_host "$WAN_IP")"
}

setup_logging() {
  # --verify may APPEND to an existing log; it must never create a file. Called AFTER the arg loop.
  [ "$(id -u)" = 0 ] || return 0
  if [ "$VERIFY_ONLY" = yes ]; then
    [ -f "$SCRIPT_LOG" ] || return 0
  elif ! touch "$SCRIPT_LOG" 2>/dev/null; then
    warn "cannot write $SCRIPT_LOG — continuing without a log file."; return 0
  else
    chmod 600 "$SCRIPT_LOG" 2>/dev/null
  fi
  exec > >(log_pipe) 2>&1
  LOG_PID=$!
  trap log_flush EXIT
  echo
  echo "=================================================================================="
  echo "install_omniroute.sh  REV $REV   $(date '+%Y-%m-%d %H:%M:%S %Z')   argv: $ARGV_RAW"
  echo "=================================================================================="
  say "logging this run to $SCRIPT_LOG"
  [ "$VERIFY_ONLY" = yes ] || write_logrotate
}

# Bound our own log. The EXACT path — OmniRoute's own output goes to the journal, which journald
# already bounds, so this script never writes a policy for anything but its run log.
write_logrotate() {
  [ -d /etc/logrotate.d ] || return 0
  local prev="$CHANGED_ANY"
  write_if_changed "$LOGROTATE_FILE" 0644 <<EOF
# Written by install_omniroute.sh. Rotates THIS SCRIPT'S run log only.
$SCRIPT_LOG {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 0600 root root
}
EOF
  CHANGED_ANY="$prev"
}

# Fatal. Packages are tracked apart from config files so this can never claim a pristine box after
# apt or npm ran. The run log and its rotate policy are always written — they are named, not hidden.
die() {
  echo; say "REFUSING: $*"; evidence_min; echo
  if [ "$CHANGED_ANY" = no ] && [ "$PKGS_INSTALLED" = no ]; then
    say "exit 1 — no config file was changed. Only this script's own run log ($SCRIPT_LOG) and its"
    say "         logrotate policy were written; nothing else on the box was touched."
  elif [ "$CHANGED_ANY" = no ]; then
    say "exit 1 — no config file was changed. Dependencies WERE installed (node and/or omniroute);"
    say "         that is idempotent and harmless, and no service was started or stopped."
  else
    say "exit 1 — some files were already written (see the 'written:' lines above)."
    say "         Re-running after fixing the cause is safe: every write is idempotent."
  fi
  exit 1
}

# What this script saw when it refused. Reads only.
evidence_min() {
  banner "omniroute unit as found"
  systemctl --no-pager status "$SERVICE_NAME" 2>&1 | grep -E 'Loaded:|Active:' 2>&1 \
    || echo "  (no $SERVICE_NAME unit)"
  banner "disk as found"
  df -h / 2>&1
  echo "---- end ----"
}

retry() {  # retry <n> <cmd…>
  local n=$1; shift; local i=1
  until "$@"; do
    [ "$i" -ge "$n" ] && return 1
    echo "  … '$*' failed (attempt $i/$n); retrying in 5s…" >&2
    i=$((i + 1)); sleep 5
  done
}

apt_get() { apt-get -o DPkg::Lock::Timeout=900 "$@"; }

write_if_changed() {  # write_if_changed <path> <mode>   [body on stdin]
  local path="$1" mode="$2" tmp="/root/.install_omniroute.$$"
  cat > "$tmp" || { warn "could not stage $path"; rm -f "$tmp"; return 2; }
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    rm -f "$tmp"; echo "  unchanged: $path"; return 1
  fi
  if [ -f "$path" ]; then
    mkdir -p "$BACKUP_DIR"
    cp -a "$path" "$BACKUP_DIR/$(echo "${path#/}" | tr / _).bak-$STAMP"
  fi
  mkdir -p "$(dirname "$path")"
  if ! cat "$tmp" > "$path"; then
    warn "could not write $path"; rm -f "$tmp"; return 2
  fi
  chmod "$mode" "$path"; rm -f "$tmp"
  echo "  written:   $path"; CHANGED_ANY=yes; return 0
}

check() {  # check <core|api> <label> <cmd…>
  local kind="$1" label="$2"; shift 2
  if "$@" >/dev/null 2>&1; then
    echo "omniroute: PASS  $label"
  else
    echo "omniroute: FAIL  $label"
    case "$kind" in core) CORE_FAIL=1 ;; api) API_FAIL=1 ;; esac
  fi
}

svc_active() { systemctl is-active --quiet "$1"; }

unit_main_pid() { systemctl show "$SERVICE_NAME" -p MainPID --value 2>/dev/null; }

# ---- 1. preflight ---------------------------------------------------------------------------- #
preflight() {
  banner "preflight"

  [ "$(id -u)" = 0 ] || die "must run as root."

  [ -r /etc/os-release ] || die "no /etc/os-release — cannot identify this system."
  . /etc/os-release
  say "os: ${PRETTY_NAME:-unknown}  codename=${VERSION_CODENAME:-unknown}"
  [ "${ID:-}" = ubuntu ] || die "this script targets Ubuntu only (found ID=${ID:-unknown})."
  case "${VERSION_ID:-}" in
    24.04|26.04) : ;;
    *) warn "supported on Ubuntu 24.04 and 26.04; this is ${VERSION_ID:-unknown}. Continuing." ;;
  esac

  command -v systemctl >/dev/null 2>&1 || die "systemd is not running this box."

  id "$RUN_USER" >/dev/null 2>&1 || die "service user '$RUN_USER' does not exist. Create it or pass --user."
  RUN_HOME="$(getent passwd "$RUN_USER" 2>/dev/null | cut -d: -f6)"
  [ -n "$RUN_HOME" ] || RUN_HOME=/root
  [ -n "$WORKDIR" ] || WORKDIR="$RUN_HOME"
  [ -d "$WORKDIR" ] || die "working directory '$WORKDIR' is not a directory. Create it or pass --workdir."

  # The TLS port must be free OR already held by nginx (a re-run). A foreign holder is fatal:
  # writing the site anyway would give nginx a listen it can never bind.
  if ss -lntpH "sport = :$TLS_PORT" 2>/dev/null | grep -q .; then
    ss -lntpH "sport = :$TLS_PORT" 2>/dev/null | grep -q '"nginx"' \
      || die "TCP :$TLS_PORT is held by a non-nginx process. Stop it or pick another --port. Evidence: $(ss -lntpH "sport = :$TLS_PORT" 2>/dev/null | head -n1)"
  fi

  say "identity: WAN $WAN_IP -> $HOSTNAME_FQDN, UI on :$TLS_PORT -> app on :$APP_PORT"
  say "preflight ok: Ubuntu + systemd, user $RUN_USER, workdir $WORKDIR"
}

# ---- 2. binaries ----------------------------------------------------------------------------- #
# What the last install actually wired, for --verify. Without this a router installed from --bin
# outside PATH verifies against whatever PATH happens to hold now — or against nothing.
read_marker() {
  [ -f "$MARKER_FILE" ] || return 0
  [ -n "$OMNIROUTE_BIN" ] || OMNIROUTE_BIN="$(sed -n 's/^omniroute_bin=//p' "$MARKER_FILE" | head -n1)"
  [ -n "$NODE_BIN" ]      || NODE_BIN="$(sed -n 's/^node_bin=//p' "$MARKER_FILE" | head -n1)"
  # Ports too, or a --verify with no flags checks the defaults against a site installed on others.
  local p
  if [ "$PORTS_FROM_FLAGS" = no ]; then
    p="$(sed -n 's/^tls_port=//p' "$MARKER_FILE" | head -n1)"; [ -n "$p" ] && TLS_PORT="$p"
    p="$(sed -n 's/^app_port=//p' "$MARKER_FILE" | head -n1)"; [ -n "$p" ] && APP_PORT="$p"
  fi
  return 0
}

# Where `npm install -g` puts commands. A prefix outside PATH is exactly what makes `command -v`
# miss a package that is in fact installed.
npm_global_bin() {
  [ -n "$NPM_BIN" ] || return 1
  local p; p="$("$NPM_BIN" prefix -g 2>/dev/null)"
  [ -n "$p" ] || return 1
  echo "$p/bin"
}

# First usable candidate wins, else empty. A marker recorded before someone moved the binary must
# fall through to PATH, not blank the result — that was silently reporting node as missing.
first_usable() {  # first_usable <path…>
  local c
  for c in "$@"; do
    [ -n "$c" ] && [ -x "$c" ] && { readlink -f "$c"; return 0; }
  done
  return 1
}

# Quiet: fills in what exists and complains about nothing. Both the install path and --verify use
# it, and the install path calls it again after each dependency phase.
resolve_binaries() {
  local gbin=""
  NODE_BIN="$(first_usable "$NODE_BIN" "$(command -v node 2>/dev/null)")" || NODE_BIN=""
  [ -n "$NODE_BIN" ] && NODE_DIR="$(dirname "$NODE_BIN")" || NODE_DIR=""

  NPM_BIN="$(first_usable "$NPM_BIN" "$(command -v npm 2>/dev/null)" "$NODE_DIR/npm")" || NPM_BIN=""

  # PATH is not the only place: an npm prefix outside PATH is exactly what `command -v` misses.
  gbin="$(npm_global_bin 2>/dev/null)"
  OMNIROUTE_BIN="$(first_usable "$OMNIROUTE_BIN" "$(command -v omniroute 2>/dev/null)" "${gbin:+$gbin/omniroute}")" \
    || OMNIROUTE_BIN=""

  # One source of truth for the unit's PATH: install_unit writes it, verify asserts against it.
  # npm's global bin is on it because the package ships a second command, omniroute-reset-password.
  UNIT_PATH="$NODE_DIR"
  [ -n "$gbin" ] && [ "$gbin" != "$NODE_DIR" ] && UNIT_PATH="$UNIT_PATH:$gbin"
  # :+ so a missing node never leaves a leading colon, which would put the CWD on the unit's PATH.
  UNIT_PATH="${UNIT_PATH:+$UNIT_PATH:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

# omniroute declares engines ">=22.22.2 <23 || >=24.0.0 <27". Only the floor and the 23.x hole are
# checked — those are what bite; Ubuntu 26.04's nodejs is 22.22.1, one patch under.
node_version_ok() {
  local v
  [ -n "$NODE_BIN" ] || return 1
  v="$("$NODE_BIN" --version 2>/dev/null)"; v="${v#v}"
  [ -n "$v" ] || return 1
  case "${v%%.*}" in 23) return 1 ;; esac
  [ "$(printf '%s\n%s\n' "22.22.2" "$v" | sort -V | head -n1)" = "22.22.2" ]
}

# ONE refusal naming everything that is missing. Dying on the first miss cost a whole round trip:
# omniroute failed and node was never even checked.
require_binaries() {
  local missing=""
  [ -n "$NODE_BIN" ]      || missing="node"
  [ -n "$OMNIROUTE_BIN" ] || missing="${missing:+$missing and }omniroute"
  [ -z "$missing" ] || {
    [ "$NO_INSTALL" = yes ] \
      && die "$missing not found, and --no-install forbids installing. Drop --no-install to let this script install them, or pass --node/--bin with explicit paths."
    die "$missing still not found after the dependency phases. Check the apt/npm output above, then re-run — or pass --node/--bin with explicit paths."
  }

  banner "binaries"
  say "router: $OMNIROUTE_BIN"
  say "node:   $NODE_BIN  $("$NODE_BIN" --version 2>/dev/null)"
  say "unit PATH will be prefixed with $NODE_DIR"
  node_version_ok \
    || warn "node $("$NODE_BIN" --version 2>/dev/null) is outside omniroute's declared engine range (>=22.22.2 <23 || >=24.0.0 <27) — the router may refuse to start."
}

# ---- 3. node --------------------------------------------------------------------------------- #
# Mirrors install_suricata.sh's PPA handling: PROBE the repo's Release before adding it, because a
# repo that publishes nothing usable makes every later apt call fail.
ensure_node() {
  [ -n "$NODE_BIN" ] && { say "node already present: $NODE_BIN $("$NODE_BIN" --version 2>/dev/null)"; return 0; }
  [ "$NO_INSTALL" = yes ] && { warn "node is missing and --no-install was passed — not installing it."; return 0; }

  banner "installing node"
  local rel="/tmp/.nodesource-release.$$" ok=no
  install -d -m0755 /etc/apt/keyrings

  if retry 3 curl -fsSL --max-time 30 -o "$rel" "$NODESOURCE_BASE/dists/nodistro/Release"; then
    if curl -fsSL --max-time 30 "$NODESOURCE_KEY_URL" 2>/dev/null | gpg --dearmor -o "$NODESOURCE_KEYRING" 2>/dev/null; then
      chmod 0644 "$NODESOURCE_KEYRING"
      write_if_changed "$NODESOURCE_LIST" 0644 <<EOF
# Written by install_omniroute.sh — NodeSource node ${NODE_MAJOR}.x.
deb [signed-by=$NODESOURCE_KEYRING] $NODESOURCE_BASE nodistro main
EOF
      if retry 3 apt_get update && retry 3 apt_get install -y nodejs; then
        ok=yes; say "installed nodejs from NodeSource (node ${NODE_MAJOR}.x, npm bundled)"
      else
        warn "NodeSource was reachable but installing nodejs from it failed."
      fi
    else
      warn "could not import the NodeSource signing key."
    fi
  else
    warn "NodeSource publishes no usable Release at $NODESOURCE_BASE."
  fi
  rm -f "$rel"

  # A half-added repo breaks every later apt call, so tear it down before falling back.
  if [ "$ok" = no ]; then
    warn "falling back to Ubuntu's archive — its nodejs may be older than omniroute requires."
    rm -f "$NODESOURCE_LIST" "$NODESOURCE_KEYRING"
    retry 3 apt_get update
    retry 3 apt_get install -y nodejs npm && ok=yes
  fi

  [ "$ok" = yes ] || die "could not install node from NodeSource or the Ubuntu archive. See the apt output above."
  PKGS_INSTALLED=yes; INSTALLED_NODE=yes
  resolve_binaries
  [ -n "$NODE_BIN" ] || die "nodejs installed, but no 'node' command appeared on PATH."
  say "node: $NODE_BIN $("$NODE_BIN" --version 2>/dev/null)"
}

# ---- 4. omniroute ---------------------------------------------------------------------------- #
ensure_omniroute() {
  [ -n "$OMNIROUTE_BIN" ] && { say "omniroute already present: $OMNIROUTE_BIN"; return 0; }
  [ "$NO_INSTALL" = yes ] && { warn "omniroute is missing and --no-install was passed — not installing it."; return 0; }
  [ -n "$NPM_BIN" ] || die "npm is not available, so omniroute cannot be installed. Install npm, or pass --bin <path>."

  banner "installing omniroute"
  say "$NPM_BIN install -g $NPM_PKG"
  retry 3 "$NPM_BIN" install -g "$NPM_PKG" \
    || die "'npm install -g $NPM_PKG' failed. See the npm output above."
  PKGS_INSTALLED=yes; INSTALLED_OMNIROUTE=yes
  resolve_binaries
  [ -n "$OMNIROUTE_BIN" ] || die "npm reported success but no 'omniroute' command appeared, on PATH or in $(npm_global_bin)."
  say "omniroute: $OMNIROUTE_BIN"
}

# The unit sets its own PATH, so this is purely so an interactive root shell finds the command.
ensure_path() {
  local gbin
  gbin="$(npm_global_bin)" || return 0
  [ -d "$gbin" ] || return 0
  case ":$PATH:" in *":$gbin:"*) return 0 ;; esac
  write_if_changed "$PROFILE_FILE" 0644 <<EOF
# Written by install_omniroute.sh — puts npm's global bin on PATH for interactive shells.
case ":\$PATH:" in *":$gbin:"*) ;; *) PATH="$gbin:\$PATH" ;; esac
export PATH
EOF
  say "$gbin was not on PATH — added it via $PROFILE_FILE (new logins pick it up)."
}

# ---- 4b. password ---------------------------------------------------------------------------- #
# Interactive fallback for --password, called before setup_logging so nothing here reaches the run
# log. Silent on a non-TTY run, and an empty entry leaves the install exactly as --password-less.
prompt_password() {
  [ -t 0 ] && [ -t 1 ] || return 0
  local p1 p2
  while :; do
    printf 'omniroute: management password (Enter to skip): ' >&2
    IFS= read -rs p1 || { echo >&2; return 0; }
    echo >&2
    [ -n "$p1" ] || { say "no password entered — the dashboard password is left as it is."; return 0; }
    printf 'omniroute: repeat it: ' >&2
    IFS= read -rs p2 || { echo >&2; return 0; }
    echo >&2
    [ "$p1" = "$p2" ] && { OMNI_PASSWORD="$p1"; return 0; }
    echo "omniroute: the two entries did not match — try again." >&2
  done
}

# INITIAL_PASSWORD only applies at bootstrap (and skips the setup wizard); an already-initialised
# install needs the package's own resetter. Both are supported paths — nothing here patches the app.
set_password() {
  [ -n "$OMNI_PASSWORD" ] || return 0
  banner "management password"
  install -d -m0755 "$MARKER_DIR"

  # The value is never echoed: setup_logging tees stdout to $SCRIPT_LOG, so only the path is printed.
  local tmp="/root/.omniroute-env.$$"
  ( umask 077; printf 'INITIAL_PASSWORD=%s\n' "$OMNI_PASSWORD" > "$tmp" ) || {
    rm -f "$tmp"; warn "could not stage $ENV_FILE — password not set."; return 0; }
  if [ -f "$ENV_FILE" ] && cmp -s "$tmp" "$ENV_FILE"; then
    rm -f "$tmp"; echo "  unchanged: $ENV_FILE"
  else
    mv "$tmp" "$ENV_FILE" && chmod 0600 "$ENV_FILE" && chown root:root "$ENV_FILE" \
      && { echo "  written:   $ENV_FILE (mode 0600)"; CHANGED_ANY=yes; } \
      || { rm -f "$tmp"; warn "could not write $ENV_FILE — password not set."; return 0; }
  fi

  # Force it onto an install that already bootstrapped. Output discarded: it echoes the password.
  if [ -n "$OMNIROUTE_BIN" ]; then
    if printf '%s' "$OMNI_PASSWORD" | "$OMNIROUTE_BIN" reset-password --password-stdin >/dev/null 2>&1; then
      say "management password applied to the existing install"
    else
      warn "'omniroute reset-password --password-stdin' did not succeed; INITIAL_PASSWORD still"
      warn "applies on a fresh database. Set it in the dashboard if login fails."
    fi
  fi
}

# ---- 5. nginx package ------------------------------------------------------------------------ #
# nginx-core, never the `nginx` metapackage: install_suricata.sh's remove_ui() purges the
# metapackage, and the console relies on the same distinction. Sharing the package is safe.
ensure_nginx() {
  command -v nginx >/dev/null 2>&1 && return 0
  [ "$NO_INSTALL" = yes ] && { warn "nginx is missing and --no-install was passed — the UI will not be published."; return 0; }
  banner "installing nginx"
  retry 3 apt_get update
  retry 3 apt_get install -y nginx-core || die "could not install nginx-core. See the apt output above."
  PKGS_INSTALLED=yes
  say "installed nginx-core"
}

# ---- 6. TLS ---------------------------------------------------------------------------------- #
# Valid > 30d, and the SAN carries our hostname + WAN IP + 127.0.0.1, and --renew-cert not set.
cert_is_good() {
  [ "$RENEW_CERT" = no ] || return 1
  [ -f "$TLS_DIR/server.crt" ] || return 1
  openssl x509 -checkend 2592000 -noout -in "$TLS_DIR/server.crt" >/dev/null 2>&1 || return 1
  local san
  san="$(openssl x509 -noout -ext subjectAltName -in "$TLS_DIR/server.crt" 2>/dev/null)"
  echo "$san" | grep -q "$HOSTNAME_FQDN" || return 1
  echo "$san" | grep -q "$WAN_IP" || return 1
  echo "$san" | grep -q "127.0.0.1"
}

make_tls() {
  banner "TLS"
  command -v openssl >/dev/null 2>&1 || die "openssl is not installed — needed to generate the TLS leaf."
  install -d -m0755 "$TLS_DIR"

  # SANs cover the FQDN, the wildcard domain, localhost and both IPs, so WAN and tunnel both verify.
  write_if_changed "$TLS_DIR/openssl.cnf" 0644 <<EOF
# Written by install_omniroute.sh — X.509 config for the OmniRoute self-signed SAN leaf.
[req]
distinguished_name = dn
x509_extensions = v3_leaf
prompt = no

[dn]
CN = $HOSTNAME_FQDN
O = OmniRoute AI Router
C = IL

[v3_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt

[alt]
DNS.1 = $HOSTNAME_FQDN
DNS.2 = *.$DNS_DOMAIN
DNS.3 = localhost
IP.1 = $WAN_IP
IP.2 = 127.0.0.1
EOF

  if cert_is_good; then
    say "existing leaf is valid >30d and the SAN matches — keeping it (pass --renew-cert to force)."
    return 0
  fi

  openssl genrsa -out "$TLS_DIR/server.key" 2048 >/dev/null 2>&1 || die "openssl could not generate server.key."
  chmod 0600 "$TLS_DIR/server.key"; chown root:root "$TLS_DIR/server.key"
  openssl req -x509 -new -key "$TLS_DIR/server.key" -out "$TLS_DIR/server.crt" -days 3650 -sha256 \
    -config "$TLS_DIR/openssl.cnf" -extensions v3_leaf >/dev/null 2>&1 \
    || die "openssl could not generate the self-signed leaf."
  chmod 0644 "$TLS_DIR/server.crt"; chown root:root "$TLS_DIR/server.crt"
  CHANGED_ANY=yes
  say "self-signed TLS leaf generated (SAN: $HOSTNAME_FQDN, *.$DNS_DOMAIN, localhost, $WAN_IP, 127.0.0.1)"
}

# ---- 7. nginx site --------------------------------------------------------------------------- #
# A socket can exist for 200ms during a FAILED reload. Only a real response proves the site is up.
site_answers() {
  [ "$(curl -sk -o /dev/null -m 3 -w '%{http_code}' "https://127.0.0.1:$TLS_PORT/" 2>/dev/null)" != 000 ]
}

install_nginx() {
  banner "nginx site"
  command -v nginx >/dev/null 2>&1 || { warn "nginx is not installed — skipping the UI front door."; return 0; }

  local ver http2=""
  ver="$(nginx -v 2>&1 | sed 's/.*nginx\///; s/ .*//')"
  if printf '%s\n1.25.1\n' "$ver" | sort -V | tail -n1 | grep -qx "$ver"; then
    http2="http2 on;"
  fi
  say "nginx $ver — http2='${http2:-off}'"

  # EVERY http-context name here must differ from the suricata-console site's, or `nginx -t` fails
  # with a duplicate and takes BOTH sites down: omniroute_app, $omni_conn_upgrade, OmniRouteTLS.
  local rc
  write_if_changed "$NGX_SITE_AVAIL" 0644 <<EOF
# omniroute-console — nginx site: OmniRoute dashboard + API over TLS on :$TLS_PORT.
# Run: written by install_omniroute.sh; re-run it to change this file, hand edits are overwritten.
# Note: no :80/:443 block — the suricata-console site owns those with a catch-all server_name.
upstream omniroute_app {
    server 127.0.0.1:$APP_PORT;
    keepalive 16;
}

# Named \$omni_conn_upgrade, never \$connection_upgrade: the console's site already declares that.
map \$http_upgrade \$omni_conn_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen $WAN_IP:$TLS_PORT ssl;
    listen 127.0.0.1:$TLS_PORT ssl;
    $http2
    server_name $HOSTNAME_FQDN $WAN_IP localhost;

    ssl_certificate     $TLS_DIR/server.crt;
    ssl_certificate_key $TLS_DIR/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    # Zone name must not collide with the console's SuricataTLS.
    ssl_session_cache shared:OmniRouteTLS:10m;
    ssl_session_tickets off;
    ssl_stapling off;

    # An AI gateway streams: uploads are prompts, downloads are token streams.
    client_max_body_size 64m;

    location = /trust/server.crt {
        alias $TLS_DIR/server.crt;
        default_type application/x-x509-ca-cert;
        add_header Content-Disposition 'attachment; filename="omniroute-console.crt"';
    }

    # One location: the dashboard, /v1 and /api/mcp/* are one process on one port.
    location / {
        proxy_pass http://omniroute_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$omni_conn_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port $TLS_PORT;

        # SSE (/api/mcp/sse) and streamed completions both stall behind a buffer, and a model
        # answer can outrun the 60s default — so buffering off and a long read timeout.
        proxy_buffering off;
        gzip off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;

        # Strip the login page's hardcoded default-password hint in flight. Rewriting here leaves
        # the npm package untouched, so an upgrade cannot silently restore it. English text only.
        proxy_set_header Accept-Encoding "";
        # text/html is always filtered and listing it here is a duplicate-MIME warning; adding
        # text/x-component covers Next.js RSC payloads. Streams are neither, so they pass untouched.
        sub_filter_types text/x-component;
        sub_filter '$HINT_EN' '';
        sub_filter_once off;

        # No Content-Security-Policy: the console's 'self' policy is written for a SPA we control.
        # Applying it blind to a third-party dashboard would break it silently.
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
    }
}
EOF
  rc=$?
  [ "$rc" = 2 ] && die "could not write $NGX_SITE_AVAIL."

  ln -sfn "$NGX_SITE_AVAIL" "$NGX_SITE_ENABLED"

  # THE GATE. On failure: unlink, re-test, and refuse rather than leave nginx unable to reload —
  # that would take the suricata console down with us.
  if ! nginx -t 2>&1; then
    echo "---- nginx -t output above ----"
    rm -f "$NGX_SITE_ENABLED"
    nginx -t >/dev/null 2>&1 && say "reverted our site; nginx config is valid again without it."
    die "nginx -t rejected our site (output above). Left it unlinked; nginx and the console are unbroken."
  fi
  say "nginx -t passed"

  systemctl enable nginx >/dev/null 2>&1
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx >/dev/null 2>&1
  else
    systemctl start nginx >/dev/null 2>&1
  fi

  local i
  for i in 1 2 3 4 5; do
    site_answers && { say "nginx is serving :$TLS_PORT"; return 0; }
    sleep 1
  done
  # A reload cannot add a new listen socket in every case; only a restart is guaranteed to bind it.
  warn "nginx reloaded but :$TLS_PORT is not answering — restarting nginx."
  systemctl restart nginx >/dev/null 2>&1
  for i in 1 2 3 4 5 6 7 8 9 10; do
    site_answers && { say "nginx is serving :$TLS_PORT (after restart)"; return 0; }
    sleep 1
  done
  warn "nginx is not serving :$TLS_PORT — check: journalctl -u nginx -n 40. Last errors:"
  tail -n 5 /var/log/nginx/error.log 2>&1 | sed 's/^/  nginx: /'
}

# Measured, never assumed: the app may ignore HOST=, and then the dashboard is also served in the
# clear on the WAN. Prints the addresses that prove it. [::1] counts as loopback; 0.0.0.0 does not.
app_listen_addrs() {
  ss -lntH "sport = :$APP_PORT" 2>/dev/null | awk '{print $4}'
}

# ---- 8. systemd unit ------------------------------------------------------------------------- #
install_unit() {
  banner "systemd unit"
  local rc

  # No ProtectSystem/NoNewPrivileges: nothing here establishes what the router writes, and an
  # unverified hardening line would fail silently as root.
  write_if_changed "$UNIT_FILE" 0644 <<EOF
# Written by install_omniroute.sh REV $REV — do not hand-edit; re-run the installer.
# Note: PATH carries $NODE_DIR because omniroute is a Node CLI started outside a login shell.
[Unit]
Description=OmniRoute AI Router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$WORKDIR

Environment="HOME=$RUN_HOME"
Environment="PATH=$UNIT_PATH"
# HOSTNAME is the bind lever: this is a Next.js standalone server, whose dist/server.js reads
# process.env.HOSTNAME || '0.0.0.0'. HOST is declared nowhere and was ignored — hence 0.0.0.0.
Environment="HOSTNAME=127.0.0.1"
Environment="HOST=127.0.0.1"
Environment="PORT=$APP_PORT"
# No anonymous /v1, ever (owner). Flags resolve DB override > env > default(false), so a dashboard
# toggle still outranks this line — which is why verify asserts the BEHAVIOUR, not just this string.
Environment="REQUIRE_API_KEY=true"
# Optional (leading -): holds INITIAL_PASSWORD at 0600 when --password was passed. Never
# Environment=, which would expose the secret through `systemctl cat` on this 0644 unit.
EnvironmentFile=-$ENV_FILE

ExecStart=$OMNIROUTE_BIN

Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  rc=$?
  [ "$rc" = 2 ] && die "could not write $UNIT_FILE."

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 \
    || warn "$SERVICE_NAME did not enable — it will not come back after a reboot."

  # Always restart, never `enable --now`: --now is a no-op on a running unit, so a rewritten
  # ExecStart or PATH would keep being served by the old process.
  systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 \
    || warn "$SERVICE_NAME did not restart — check: journalctl -u $SERVICE_NAME -n 40"

  # Restart=always means "active" 100ms in proves nothing. RestartSec=5, so 12s clears two full
  # crash-loop cycles — and it is what makes verify's "up for at least 10s" meaningful here.
  say "letting the router settle for 12s before verifying…"
  sleep 12
  svc_active "$SERVICE_NAME" && say "$SERVICE_NAME active" \
    || warn "$SERVICE_NAME is NOT active (the router is down until it is)."
}

# ---- 9. login banner ------------------------------------------------------------------------- #
# $MOTD_FILE is an EXECUTABLE in Ubuntu's dynamic-MOTD directory: pam_motd RUNS every file there and
# prints its stdout, so a shebang is required and /etc/motd is not a fallback (it is cat'd).
write_motd() {
  banner "login how-to (MOTD)"
  if [ ! -d /etc/update-motd.d ]; then
    warn "/etc/update-motd.d does not exist — skipping the login how-to."
    return 0
  fi
  # Resolved BEFORE the heredoc, never as $( ) inside it: our heredoc is unquoted, so it would run.
  local self rc
  self="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"

  # Outer heredoc unquoted — that is what bakes the hostname and ports in. Inner one QUOTED, so
  # nothing in the printed text is expanded at login; every runtime $ below it is escaped.
  write_if_changed "$MOTD_FILE" 0755 <<EOF
#!/bin/sh
# Written by install_omniroute.sh. Printed at every login by pam_motd.
cat <<'MOTD'

  OMNIROUTE AI ROUTER — dashboard + OpenAI-compatible API, behind nginx on TLS.

  Dashboard                  https://$HOSTNAME_FQDN:$TLS_PORT/
  API base URL               https://$HOSTNAME_FQDN:$TLS_PORT/v1
  API access                 KEY-ONLY — Authorization: Bearer <key in $API_KEY_FILE>
  Ask a model                bash $SELF_DIR/ai/ask.sh --check   then   ask.sh "your prompt"
  Service                    systemctl status $SERVICE_NAME
  Logs (follow)              journalctl -u $SERVICE_NAME -f
  Re-check OmniRoute         bash $self --verify

MOTD
# Evaluated at every login, not baked in, so the banner cannot go stale.
systemctl is-active --quiet $SERVICE_NAME \\
  || echo "  ** OMNIROUTE IS NOT RUNNING — journalctl -u $SERVICE_NAME -n 40 **"
ss -lntH 'sport = :$APP_PORT' 2>/dev/null | awk '{print \$4}' | grep -qvE '^(127\.0\.0\.1|\[::1\]):' \\
  && echo "  ** :$APP_PORT also answers IN THE CLEAR (no TLS) — that path bypasses the site above **"
echo
EOF
  rc=$?
  [ "$rc" = 2 ] && { warn "could not write the login how-to at $MOTD_FILE."; return 0; }
  say "login how-to installed at $MOTD_FILE — it prints at every login"
}

# ---- 10. marker ------------------------------------------------------------------------------ #
# installed_* is STICKY: only the run that installed a dependency sets it, and every later run must
# carry it forward — --full-uninstall reads it to decide what it is allowed to remove.
write_marker() {
  local prev
  if [ -f "$MARKER_FILE" ]; then
    prev="$(sed -n 's/^installed_node=//p' "$MARKER_FILE" | head -n1)"
    [ "$prev" = yes ] && INSTALLED_NODE=yes
    prev="$(sed -n 's/^installed_omniroute=//p' "$MARKER_FILE" | head -n1)"
    [ "$prev" = yes ] && INSTALLED_OMNIROUTE=yes
  fi
  install -d -m0755 "$MARKER_DIR"
  # installed_at makes this file differ every run by design; it is the only such write.
  write_if_changed "$MARKER_FILE" 0644 <<EOF
# Written by install_omniroute.sh — do not hand-edit.
rev=$REV
installed_at=$(date '+%Y-%m-%d %H:%M:%S %Z')
omniroute_bin=$OMNIROUTE_BIN
node_bin=$NODE_BIN
node_version=$("${NODE_BIN:-false}" --version 2>/dev/null)
user=$RUN_USER
workdir=$WORKDIR
unit=$UNIT_FILE
url=https://$HOSTNAME_FQDN:$TLS_PORT/
tls_port=$TLS_PORT
app_port=$APP_PORT
installed_node=$INSTALLED_NODE
installed_omniroute=$INSTALLED_OMNIROUTE
EOF
}

# ---- verification ---------------------------------------------------------------------------- #
CORE_FAIL=0; API_FAIL=0

# All three guard on svc_active first: systemctl reports a stopped unit's LAST timestamps, which
# would otherwise let a dead router pass as steady and old.

# Restart=always hides a crash loop behind a permanently "active" unit. Two NRestarts reads a few
# seconds apart is the only cheap proof it is not respawning.
not_crash_looping() {
  local a b
  svc_active "$SERVICE_NAME" || return 1
  a="$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null)"
  sleep 6
  b="$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null)"
  [ -n "$a" ] && [ "$a" = "$b" ]
}

# A process that dies and respawns reports a fresh ActiveEnterTimestamp every cycle, so an old one
# is the proof it survived.
up_at_least_10s() {
  local t now
  svc_active "$SERVICE_NAME" || return 1
  t="$(systemctl show "$SERVICE_NAME" -p ActiveEnterTimestamp --value 2>/dev/null)"
  [ -n "$t" ] || return 1
  t="$(date -d "$t" +%s 2>/dev/null)" || return 1
  now="$(date +%s)"
  [ "$(( now - t ))" -ge 10 ]
}

# A unit file rewritten after the last start means the running process is serving the OLD argv.
unit_not_stale() {
  local svc cfg
  svc_active "$SERVICE_NAME" || return 1
  svc="$(date -d "$(systemctl show "$SERVICE_NAME" -p ActiveEnterTimestamp --value 2>/dev/null)" +%s 2>/dev/null)"
  cfg="$(stat -c %Y "$UNIT_FILE" 2>/dev/null)"
  [ -n "$svc" ] && [ -n "$cfg" ] && [ "$svc" -ge "$cfg" ]
}

verify() {
  CORE_FAIL=0; API_FAIL=0
  [ -r /etc/os-release ] && . /etc/os-release
  local pid; pid="$(unit_main_pid)"

  banner "identity"
  say "REV $REV"
  say "${PRETTY_NAME:-unknown}  kernel=$(uname -r)"
  [ -f "$MARKER_FILE" ] && { echo "--- $MARKER_FILE ---"; cat "$MARKER_FILE"; }

  banner "unit"
  systemctl --no-pager status "$SERVICE_NAME" 2>&1 | grep -E 'Loaded:|Active:|Main PID:' 2>&1 \
    || echo "  (no $SERVICE_NAME unit)"
  echo "enabled: $(systemctl is-enabled "$SERVICE_NAME" 2>&1)  restarts: $(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>&1)"

  banner "binaries"
  echo "omniroute: ${OMNIROUTE_BIN:-<not found>}"
  echo "node:      ${NODE_BIN:-<not found>}  $("${NODE_BIN:-false}" --version 2>/dev/null)"

  banner "listeners held by the router"
  if [ -n "$pid" ] && [ "$pid" != 0 ]; then
    ss -lntpH 2>/dev/null | grep "pid=$pid," || echo "  (the router holds no TCP listener)"
  else
    echo "  (no main pid — the unit is not running)"
  fi

  banner "front door"
  echo "site: $NGX_SITE_ENABLED -> $([ -L "$NGX_SITE_ENABLED" ] && readlink "$NGX_SITE_ENABLED" || echo '(not linked)')"
  echo "nginx enabled: $(systemctl is-enabled nginx 2>&1)  active: $(systemctl is-active nginx 2>&1)"
  openssl x509 -noout -subject -enddate -in "$TLS_DIR/server.crt" 2>&1

  banner "recent journal"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>&1

  # ---- assertions ----
  banner "assertions"
  check core "unit file present"                    test -f "$UNIT_FILE"
  check core "unit enabled"                         systemctl is-enabled --quiet "$SERVICE_NAME"
  check core "unit active"                          svc_active "$SERVICE_NAME"
  check core "main pid is non-zero"                 sh -c "p=\$(systemctl show $SERVICE_NAME -p MainPID --value); [ -n \"\$p\" ] && [ \"\$p\" != 0 ]"
  check core "omniroute binary is executable"       test -x "${OMNIROUTE_BIN:-/nonexistent}"
  check core "node binary runs"                     sh -c "'${NODE_BIN:-false}' --version"
  # The trap this box walks into: Ubuntu 26.04's nodejs is 22.22.1, one patch below the floor.
  check api  "node satisfies omniroute's engines"   node_version_ok
  # ExecStart is absolute, so this is about the router finding node and its sibling commands.
  check api  "omniroute resolves from the unit PATH" sh -c "PATH='$UNIT_PATH' command -v omniroute"
  # The single reason this unit exists: without node's dir on PATH the router cannot spawn node.
  check core "unit PATH carries node's directory"   sh -c "systemctl show $SERVICE_NAME -p Environment --value 2>/dev/null | grep -q 'PATH=${NODE_DIR:-__unset__}:'"
  check api  "unit restarted after the unit file changed" unit_not_stale
  check api  "up for at least 10s"                  up_at_least_10s
  check api  "not crash-looping (NRestarts steady)" not_crash_looping

  # ---- the front door ----
  check core "the app answers on 127.0.0.1:$APP_PORT" sh -c "test \"\$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:$APP_PORT/)\" != 000"

  # ---- key-only access ----
  # On loopback, not the TLS site: this is the router's own policy, not nginx's. Behaviour first —
  # a dashboard-written DB override outranks the unit's env, and only these two catch that.
  check core "anonymous /v1 is refused"             sh -c "test \"\$(curl -s -o /dev/null -m 8 -w '%{http_code}' http://127.0.0.1:$APP_PORT/v1/models)\" = 401"
  check core "an invalid key is refused"            sh -c "test \"\$(curl -s -o /dev/null -m 8 -H 'Authorization: Bearer sk-invalid-key-for-verify' -w '%{http_code}' http://127.0.0.1:$APP_PORT/v1/models)\" = 401"
  check api  "unit carries REQUIRE_API_KEY=true"    sh -c "systemctl show $SERVICE_NAME -p Environment --value 2>/dev/null | grep -q 'REQUIRE_API_KEY=true'"

  check core "nginx installed"                      command -v nginx
  check core "site symlinked"                       test -L "$NGX_SITE_ENABLED"
  check core "nginx -t ok"                          nginx -t
  check core "nginx active"                         svc_active nginx
  check core "listening on :$TLS_PORT"              sh -c "ss -lntpH 'sport = :$TLS_PORT' 2>/dev/null | grep -q nginx"
  check core "TLS answers on :$TLS_PORT"            site_answers
  # 307 -> /dashboard is what a healthy OmniRoute returns at /; any 2xx/3xx proves the proxy works.
  check api  "proxy reaches the dashboard"          sh -c "c=\$(curl -sk -o /dev/null -m 8 -w '%{http_code}' --resolve $HOSTNAME_FQDN:$TLS_PORT:127.0.0.1 https://$HOSTNAME_FQDN:$TLS_PORT/); case \"\$c\" in 2*|3*) exit 0 ;; esac; exit 1"
  check core "cert valid > 30d"                     openssl x509 -checkend 2592000 -noout -in "$TLS_DIR/server.crt"
  # pam_motd runs only EXECUTABLES, so a cleared bit silences the banner without deleting anything.
  check api  "login banner present + executable"    test -x "$MOTD_FILE"
  check core "cert SAN has hostname + WAN IP + 127.0.0.1" sh -c "s=\$(openssl x509 -noout -ext subjectAltName -in $TLS_DIR/server.crt 2>/dev/null); echo \"\$s\" | grep -q '$HOSTNAME_FQDN' && echo \"\$s\" | grep -q '$WAN_IP' && echo \"\$s\" | grep -q 127.0.0.1"

  # Present but not executable is a specific, recoverable state: something cleared the bit.
  if [ -f "$MOTD_FILE" ] && [ ! -x "$MOTD_FILE" ]; then
    warn "$MOTD_FILE exists but is not executable, so pam_motd skips it and the banner never prints."
    warn "Restore it with:  chmod +x $MOTD_FILE"
  fi

  banner "exposure"
  local addrs; addrs="$(app_listen_addrs)"
  if [ -z "$addrs" ]; then
    warn "nothing is listening on :$APP_PORT — the router is down, so the site will return 502."
  elif echo "$addrs" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then
    warn "omniroute is NOT loopback-only. It is listening on:"
    echo "$addrs" | sed 's/^/    /'
    warn "so the dashboard is ALSO reachable in the clear at http://$WAN_IP:$APP_PORT, which"
    warn "bypasses the TLS site entirely. The unit sets HOSTNAME=127.0.0.1, which this Next.js"
    warn "server reads as its bind address — if this warns, the app did not pick it up. Restart it,"
    warn "or filter :$APP_PORT; this script never writes nftables."
  else
    say "omniroute listens on loopback only — the TLS site on :$TLS_PORT is the only way in."
  fi

  echo
  banner "operating it"
  say "URL:            https://$HOSTNAME_FQDN:$TLS_PORT/"
  say "URL (by IP):    https://$WAN_IP:$TLS_PORT/   (use this if the hostname does not resolve for you)"
  say "SSH tunnel:     ssh -N -L $TLS_PORT:127.0.0.1:$TLS_PORT root@$WAN_IP   then  https://localhost:$TLS_PORT/"
  say "Trust anchor:   https://$HOSTNAME_FQDN:$TLS_PORT/trust/server.crt"
  say "API access:     KEY-ONLY — every /v1 call needs 'Authorization: Bearer <key>'; the dashboard"
  say "                keeps working on its own session. Key: $API_KEY_FILE (written by ISO-Updates)"
  say "Ask a model:    bash $SELF_DIR/ai/ask.sh --check   then   $SELF_DIR/ai/ask.sh \"your prompt\""
  say "Status:         systemctl status $SERVICE_NAME"
  say "Logs (follow):  journalctl -u $SERVICE_NAME -f"
  say "Restart:        systemctl restart $SERVICE_NAME"
  say "Stop:           systemctl stop $SERVICE_NAME"
  say "Disable boot:   systemctl disable $SERVICE_NAME"
  say "Unit file:      $UNIT_FILE   (re-run this script to change it; hand edits are overwritten)"
  if [ -f "$SCRIPT_LOG" ]; then
    say "Run log:        $SCRIPT_LOG  ($(wc -l < "$SCRIPT_LOG" 2>/dev/null | tr -d ' ') lines, $(du -h "$SCRIPT_LOG" 2>/dev/null | cut -f1))"
  else
    say "Run log:        $SCRIPT_LOG (not written this run)"
  fi

  echo
  local rc=0
  if [ "$CORE_FAIL" = 1 ] || [ "$API_FAIL" = 1 ]; then
    rc=2
    [ "$CORE_FAIL" = 1 ] && say "VERDICT — OmniRoute is DEGRADED (exit 2): the unit/binary layer has a FAIL above."
    [ "$CORE_FAIL" = 0 ] && say "VERDICT — the unit is installed but UNSTABLE (exit 2): stale or restarting. See the FAIL lines."
  else
    say "VERDICT — OmniRoute up (exit 0). Follow it with: journalctl -u $SERVICE_NAME -f"
  fi
  echo "---- end ----"
  return $rc
}

# ---- uninstall ------------------------------------------------------------------------------- #
# Dependencies come out ONLY under --full-uninstall, and only when the marker says THIS script
# installed them. A dependency that was already on the box when we arrived is never touched.
uninstall() {
  banner "uninstall"

  # Read the marker before anything deletes it, and resolve npm while it is still installed.
  local mine_node=no mine_omni=no
  if [ -f "$MARKER_FILE" ]; then
    [ "$(sed -n 's/^installed_node=//p' "$MARKER_FILE" | head -n1)" = yes ] && mine_node=yes
    [ "$(sed -n 's/^installed_omniroute=//p' "$MARKER_FILE" | head -n1)" = yes ] && mine_omni=yes
  fi
  resolve_binaries

  systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 && say "stopped + disabled $SERVICE_NAME"

  # The unit is removed by the loop, not before it — deleting it early made the count miss one.
  # $ENV_FILE and $API_KEY_FILE sit inside $MARKER_DIR, so a plain --uninstall takes both secrets.
  # Deliberate: with the unit gone they are credentials lying on disk; ISO-Updates re-pushes the key.
  local p removed=0 what="unit, marker, password env, API key, nginx site, login banner"
  local paths=("$UNIT_FILE" "$MARKER_DIR" "$NGX_SITE_ENABLED" "$NGX_SITE_AVAIL" "$MOTD_FILE")
  if [ "$FULL_UNINSTALL" = yes ]; then
    paths+=("$LOGROTATE_FILE" "$BACKUP_DIR" "$PROFILE_FILE" "$TLS_DIR")
    what="$what, logrotate policy, backups, PATH profile, TLS"
  fi
  # -L as well as -e: a dangling sites-enabled symlink is invisible to -e but must still go.
  for p in "${paths[@]}"; do
    if [ -e "$p" ] || [ -L "$p" ]; then rm -rf "$p"; removed=$((removed + 1)); fi
  done
  systemctl daemon-reload

  # NEVER purge nginx: the suricata console may be sharing it. Reload so our site stops being served.
  if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx >/dev/null 2>&1; say "reloaded nginx without our site"
    else
      warn "nginx -t failed after removing our site — leaving nginx as-is; check by hand."
    fi
  fi
  if [ "$removed" = 0 ]; then
    say "nothing to remove — no OmniRoute unit files were present."
  else
    say "removed $removed path(s): $what"
  fi

  if [ "$FULL_UNINSTALL" = yes ]; then
    if [ "$mine_omni" = yes ] && [ -n "$NPM_BIN" ]; then
      "$NPM_BIN" rm -g "$NPM_PKG" >/dev/null 2>&1 && say "removed the global npm package $NPM_PKG" \
        || warn "could not remove the npm package $NPM_PKG — remove it by hand."
    fi
    # NEVER autoremove: that sweeper takes unrelated packages.
    if [ "$mine_node" = yes ]; then
      rm -f "$NODESOURCE_LIST" "$NODESOURCE_KEYRING"
      apt_get purge -y nodejs >/dev/null 2>&1 && say "purged nodejs and removed the NodeSource repo" \
        || warn "could not purge nodejs — remove it by hand."
    fi
    [ "$mine_omni" = no ] && [ "$mine_node" = no ] \
      && say "KEPT node and omniroute — the marker says this script did not install them."
  else
    say "KEPT: $LOGROTATE_FILE, backups under $BACKUP_DIR, and the TLS dir $TLS_DIR."
    say "KEPT: node and omniroute — pass --full-uninstall to remove what this script installed."
  fi
  say "KEPT: nginx itself — the suricata console may be sharing it."
  say "uninstall complete."

  if [ "$FULL_UNINSTALL" = yes ]; then
    evidence_min
    # LAST: setup_logging already opened this file and log_pipe holds it. Unlinking it here keeps
    # the console output whole and frees the space at exit.
    rm -f "$SCRIPT_LOG" "$SCRIPT_LOG".*
  fi
}

usage() {
  sed -n '2,4p' "$0" | sed 's/^# //'
  cat <<'USAGE'

Usage: bash install_omniroute.sh [flags]
  --verify           read-only health check; prints a VERDICT and exits 0 (up) / 2 (degraded)
                     appends to the run log if one exists; writes nothing else
  --uninstall        stop + disable the unit and remove it and the marker; KEEPS the logrotate
                     policy, the backups, the run log, and both dependencies
  --full-uninstall   as --uninstall, and ALSO delete the logrotate policy, the backups, the PATH
                     profile and the run log, AND remove node + omniroute — but only the ones the
                     marker records this script as having installed
  --no-install       never touch apt or npm; refuse instead if node or omniroute is missing
  --password <v>     set the dashboard's management password.
  --bin <path>       omniroute executable                 (default: PATH, then npm's global bin)
  --node <path>      node executable                      (default: first on PATH)
  --user <name>      unit User=                           (default: root)
  --workdir <dir>    unit WorkingDirectory=               (default: the user's home)
  --port <n>         TLS port nginx publishes the UI on   (default 9443)
  --app-port <n>     omniroute's own listener, proxied    (default 20128)
  --wan-ip <addr>    bind address + cert SAN IP           (default: default-route source address)
  --hostname <fqdn>  cert CN/SAN + published hostname     (default: <dashed WAN IP>.dev-cloud-xip.com)
  --renew-cert       regenerate the TLS leaf even if the current one is still valid
  -h, --help         this help
USAGE
}

# ---- main ------------------------------------------------------------------------------------ #
# ARGUMENTS PARSED FIRST — setup_logging writes, and --verify must change nothing. $ARGV_RAW (set
# above, before any shift) is what the log header records.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --verify)         VERIFY_ONLY=yes ;;
    --uninstall)      UNINSTALL=yes ;;
    # Implies --uninstall so it cannot be mistaken for a log-only operation.
    --full-uninstall) UNINSTALL=yes; FULL_UNINSTALL=yes ;;
    --no-install)     NO_INSTALL=yes ;;
    --password)       shift; OMNI_PASSWORD="${1:?--password needs a value}" ;;
    --bin)            shift; OMNIROUTE_BIN="${1:?--bin needs a path}" ;;
    --node)           shift; NODE_BIN="${1:?--node needs a path}" ;;
    --user)           shift; RUN_USER="${1:?--user needs a name}" ;;
    --workdir)        shift; WORKDIR="${1:?--workdir needs a directory}" ;;
    --port)           shift; TLS_PORT="${1:?--port needs a value}"; PORTS_FROM_FLAGS=yes ;;
    --app-port)       shift; APP_PORT="${1:?--app-port needs a value}"; PORTS_FROM_FLAGS=yes ;;
    --wan-ip)         shift; WAN_IP="${1:?--wan-ip needs an address}" ;;
    --hostname)       shift; HOSTNAME_FQDN="${1:?--hostname needs a value}" ;;
    --renew-cert)     RENEW_CERT=yes ;;
    -h|--help)        usage; exit 0 ;;
    *)                echo "omniroute: unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done

for p in "$TLS_PORT" "$APP_PORT"; do
  case "$p" in ''|*[!0-9]*) echo "omniroute: ports must be numeric (got '$p')" >&2; exit 1 ;; esac
done
[ "$TLS_PORT" = "$APP_PORT" ] \
  && { echo "omniroute: --port and --app-port must differ (both are $TLS_PORT)." >&2; exit 1; }

require_platform

# Before setup_logging on purpose: from there stdout is a pipe into log_pipe, so a prompt would be
# tee'd to $SCRIPT_LOG. --verify/--uninstall exit only after that call, so they are excluded here.
[ -z "$OMNI_PASSWORD" ] && [ "$VERIFY_ONLY" = no ] && [ "$UNINSTALL" = no ] && prompt_password

setup_logging
resolve_identity

if [ "$VERIFY_ONLY" = yes ]; then
  [ "$(id -u)" = 0 ] || { echo "omniroute: --verify needs root (most evidence does)." >&2; exit 1; }
  read_marker
  resolve_binaries
  verify
  exit $?
fi

if [ "$UNINSTALL" = yes ]; then
  [ "$(id -u)" = 0 ] || { echo "omniroute: --uninstall needs root." >&2; exit 1; }
  uninstall
  exit 0
fi

preflight
resolve_binaries
ensure_node
ensure_omniroute
ensure_path
require_binaries
ensure_nginx
make_tls
set_password
install_unit
install_nginx
write_motd
write_marker

if [ "$CHANGED_ANY" = no ] && [ "$PKGS_INSTALLED" = no ]; then
  say "no file changed and nothing installed this run — the router was already in place."
fi

verify
exit $?
