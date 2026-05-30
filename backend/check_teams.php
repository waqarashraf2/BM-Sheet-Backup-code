<?php
use Illuminate\Support\Facades\DB;
// Check team_id population across order tables
$tables = DB::select("SHOW TABLES");
$orderTables = [];
foreach($tables as $t) {
    $name = array_values((array)$t)[0];
    if(strpos($name, "_orders") !== false && strpos($name, "_backup") === false && strpos($name, "_test_") === false && strpos($name, "_old") === false) {
        $orderTables[] = $name;
    }
}
echo "Order tables to check: ".count($orderTables)."\n\n";
$totalWithTeam = 0; $totalDeliveredWithTeam = 0; $totalDeliveredToday = 0;
foreach($orderTables as $tbl) {
    try {
        $cols = array_column(DB::select("SHOW COLUMNS FROM `$tbl`"), "Field");
        if(!in_array("team_id", $cols)) { echo "NO team_id col: $tbl\n"; continue; }
        $withTeam = DB::table($tbl)->whereNotNull("team_id")->count();
        $total = DB::table($tbl)->count();
        $delWithTeam = DB::table($tbl)->whereNotNull("team_id")->where("workflow_state","DELIVERED")->count();
        $delToday = DB::table($tbl)->where("workflow_state","DELIVERED")->where("delivered_at",">=",date("Y-m-d"))->count();
        $delTodayTeam = DB::table($tbl)->whereNotNull("team_id")->where("workflow_state","DELIVERED")->where("delivered_at",">=",date("Y-m-d"))->count();
        $totalWithTeam += $withTeam;
        $totalDeliveredWithTeam += $delWithTeam;
        $totalDeliveredToday += $delToday;
        if($delToday > 0) echo "$tbl: total=$total team_id_set=$withTeam del_today=$delToday del_today_with_team=$delTodayTeam\n";
    } catch(Exception $e) { echo "  ERROR $tbl: ".$e->getMessage()."\n"; }
}
echo "\nSUMMARY:\n";
echo "Total rows with team_id set: $totalWithTeam\n";
echo "Delivered orders with team_id: $totalDeliveredWithTeam\n";
echo "Total delivered today (all): $totalDeliveredToday\n";
