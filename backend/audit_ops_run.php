<?php
use App\Http\Controllers\Api\DashboardController;
use Illuminate\Http\Request;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

$u = User::where("role","director")->orWhere("role","ceo")->first();
$req = Request::create("/api/dashboard/operations", "GET", []);
$req->setUserResolver(fn() => $u);

$cacheKey = "ops_dashboard_" . $u->id . "_" . md5(json_encode(["date"=>null,"start_date"=>null,"end_date"=>null]));
Cache::forget($cacheKey);

$ctrl = app(DashboardController::class);
$resp = $ctrl->operations($req);
$data = json_decode($resp->getContent(), true);

echo "=== TOTAL STATS ===\n";
echo "total_active_staff: ".$data["total_active_staff"]."\n";
echo "total_absent: ".$data["total_absent"]."\n";
echo "total_pending: ".$data["total_pending"]."\n";
echo "total_delivered_today: ".$data["total_delivered_today"]."\n";

echo "\n=== ROLE STATS ===\n";
foreach($data["role_stats"] as $role => $rs) {
    echo "$role: total=".$rs["total_staff"]." active=".$rs["active"]." absent=".$rs["absent"]." done_today=".$rs["today_completed"]." wip=".$rs["total_wip"]."\n";
}

echo "\n=== 7-DAY STATS ===\n";
foreach($data["date_stats"] as $d) {
    echo $d["label"]." ".$d["date"]."  recv=".$d["received"]." del=".$d["delivered"]."\n";
}

echo "\n=== PROJECT COUNT: ".count($data["projects"])." ===\n";
foreach(array_slice($data["projects"],0,8) as $p) {
    echo $p["project"]["code"]."  pending=".$p["pending"]." del_today=".$p["delivered_today"]." staff=".$p["total_staff"]." active=".$p["active_staff"]."\n";
}

echo "\n=== QA SUMMARY ===\n";
echo "total_qa_staff: ".$data["qa_summary"]["total_qa_staff"]."\n";
echo "qa_with_uploads: ".$data["qa_summary"]["qa_with_uploads"]."\n";
echo "total_qa_done: ".$data["qa_summary"]["total_qa_done"]."\n";

echo "\n=== TEAM PERF (top 10) ===\n";
foreach(array_slice($data["team_performance"],0,10) as $t) {
    echo $t["name"]."  del_today=".$t["delivered_today"]." total_done=".$t["total_done"]." staff=".$t["staff_count"]." active=".$t["active_staff"]."\n";
}

echo "\n=== WORKERS ===\n";
echo "Total: ".count($data["workers"])."\n";
$withWork = array_filter($data["workers"], fn($w) => $w["today_completed"] > 0);
echo "With completions today: ".count($withWork)."\n";
$withTarget = array_filter($data["workers"], fn($w) => $w["daily_target"] > 0);
echo "With daily_target > 0: ".count($withTarget)."\n";
$withAvg = array_filter($data["workers"], fn($w) => $w["avg_completion_minutes"] > 0);
echo "With avg_completion_minutes > 0: ".count($withAvg)."\n";
