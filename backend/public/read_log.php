<?php
$logFile = '/home/crmbenchmarkstud/laravel-backend/storage/logs/laravel.log';
if (!file_exists($logFile)) { echo "No log file found\n"; exit; }

$size = filesize($logFile);
echo "Log size: $size bytes\n\n";

// Read last 10000 bytes
$fp = fopen($logFile, 'r');
$readSize = min($size, 10000);
fseek($fp, -$readSize, SEEK_END);
$content = fread($fp, $readSize);
fclose($fp);

// Find error-related lines
$lines = explode("\n", $content);
$output = [];
foreach ($lines as $i => $line) {
    if (preg_match('/undefined relationship|orders.*doesn|submitWork|Error|SQLSTATE|500|exception/i', $line)) {
        for ($j = max(0, $i-1); $j <= min(count($lines)-1, $i+3); $j++) {
            $output[] = $lines[$j];
        }
        $output[] = "---";
    }
}

if (empty($output)) {
    echo "No matching errors found in last {$readSize} bytes.\n";
    echo "Last 30 lines:\n";
    echo implode("\n", array_slice($lines, -30));
} else {
    echo implode("\n", $output);
}
