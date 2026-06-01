<?php
// db.php
declare(strict_types=1);

define('EXTERNAL_PORTAL_13_LOGIN_URL', 'https://es-portal.captur3d.io/external_supplier/login');
define('EXTERNAL_PORTAL_13_URL', 'https://es-portal.captur3d.io/external_supplier/floorplan_orders.json');
define('EXTERNAL_PORTAL_13_USERNAME', 'm.wasim.rashid@gmail.com');
define('EXTERNAL_PORTAL_13_PASSWORD', '04629551');
define('EXTERNAL_PORTAL_13_URL_START', 'https://es-portal.captur3d.io/external_supplier/orders/%s/start');

define('EXTERNAL_PORTAL_4_URL', 'https://es-portal.captur3d.io/external_supplier/schematic_floorplan_orders?filter=pending');
define('EXTERNAL_PORTAL_4_USERNAME', 'order@benchmarkstudio.biz');
define('EXTERNAL_PORTAL_4_PASSWORD', 'OgLilaA@yqE1&Rfc');
define('EXTERNAL_PORTAL_4_URL_START', 'https://es-portal.captur3d.io/external_supplier/orders/%s/start');



function db(): PDO
{
    $host = '127.0.0.1';
    $db   = 'crmbenchmarkstud_bmdb';
    $user = 'crmbenchmarkstud_crmUser';
    $pass = 'Ygykk_BKw#$*';
    $charset = 'utf8mb4';

    $dsn = "mysql:host={$host};dbname={$db};charset={$charset}";
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false, // important for real prepares
    ];

    return new PDO($dsn, $user, $pass, $options);
}