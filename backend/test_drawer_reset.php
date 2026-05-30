<?php
// Temporary script to reset a drawer password for testing
// Deletes itself after running

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use App\Models\Order;

// Find an active drawer with orders in Metro states
$drawers = User::where('role', 'drawer')
    ->where('is_active', true)
    ->get();

echo "Active drawers: " . $drawers->count() . "\n";

// Find orders in Metro states assigned to drawers
$metroStates = ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_CHECK', 'REJECTED_BY_QA'];
$orders = Order::whereIn('workflow_state', $metroStates)
    ->whereNotNull('drawer_id')
    ->limit(10)
    ->get();

echo "Orders in Metro states with drawer: " . $orders->count() . "\n";
foreach ($orders as $o) {
    $drawer = User::find($o->drawer_id);
    echo "  Order #{$o->order_number} state={$o->workflow_state} drawer={$o->drawer_id} ({$drawer->name ?? 'unknown'})\n";
}

// Also check order 296003 specifically
$order296003 = Order::where('order_number', '296003')->first();
if ($order296003) {
    echo "\nOrder #296003: state={$order296003->workflow_state} drawer_id={$order296003->drawer_id} assigned_to={$order296003->assigned_to}\n";
}

// Find first active drawer and reset password
$targetDrawer = $drawers->first();
if ($targetDrawer) {
    $targetDrawer->password = Hash::make('testpass123');
    $targetDrawer->save();
    echo "\nReset password for drawer: {$targetDrawer->name} (ID:{$targetDrawer->id}) Email:{$targetDrawer->email}\n";
    echo "New password: testpass123\n";
}

// Also check IN_DRAW orders
$inDrawOrders = Order::where('workflow_state', 'IN_DRAW')
    ->whereNotNull('drawer_id')
    ->limit(5)
    ->get();
echo "\nOrders in IN_DRAW with drawer: " . $inDrawOrders->count() . "\n";
foreach ($inDrawOrders as $o) {
    echo "  Order #{$o->order_number} drawer_id={$o->drawer_id}\n";
}

// Self-delete
unlink(__FILE__);
echo "\n[Script self-deleted]\n";
