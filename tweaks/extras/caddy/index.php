<html>
<head>
    <title>Caddy Demo Site</title>
    <style type="text/css">
        #wrap {
            width: 900px;
            margin: 0 auto;
        }
    </style>
</head>
<body id="wrap">
    <h2>Caddy Demo Site</h2>
    <?php echo '<p>Hello, This is the default DB connection testing page.</p>';

    // Define PHP variables for the MySQL connection.
    $servername = "localhost";
    $username = "caddyuser";
    $password = "PASS";

    // Create a MySQL connection.
    $conn = mysqli_connect($servername, $username, $password);

    // Report if the connection fails or is successful.
    if (!$conn) {
        exit('<p>Your connection has failed.<p>' .  mysqli_connect_error());
    }
    echo '<p>You have connected successfully.</p>';
    ?>
</body>
</html>

