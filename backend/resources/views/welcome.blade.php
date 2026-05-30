@php
$webroot = $_SERVER['DOCUMENT_ROOT'] ?? public_path();
$jsFile = '';
$cssFile = '';
$jsTime = 0;
$cssTime = 0;
foreach (glob("$webroot/assets/index-*.js") as $f) {
    $mt = filemtime($f);
    if ($mt > $jsTime) { $jsTime = $mt; $jsFile = basename($f); }
}
foreach (glob("$webroot/assets/index-*.css") as $f) {
    $mt = filemtime($f);
    if ($mt > $cssTime) { $cssTime = $mt; $cssFile = basename($f); }
}
if (!$jsFile) {
    header('Location: https://hrm.stellarinstitute.pk/login');
    exit;
}
@endphp
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Benchmark | Enterprise Management System</title>
    <script type="module" crossorigin src="/assets/{{ $jsFile }}?v={{ $jsTime }}"></script>
    <link rel="stylesheet" crossorigin href="/assets/{{ $cssFile }}?v={{ $cssTime }}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
