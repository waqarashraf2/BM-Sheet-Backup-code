<?php
use App\Http\Controllers\Api\DashboardController;
use Illuminate\Http\Request;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

$u = User::where("role","director")->orWhere("role","ceo")->first();
$req = Request::create("/api/dashboard/master", "GET", []);
$req->setUserResolver(fn() => $u);

// Force fresh — clear cache
$cacheKey = "dashboard_master_" . today()->format("Y-m-d");
Cache::forget($cacheKey);
echo "Cleared cache key: $cacheKey\n\n";

$ctrl = app(DashboardController::class);
$resp = $ctrl->master($req);
$data = json_decode($resp->getContent(), true);
$org = $data["org_totals"];

echo "=== ORG TOTALS (FRESH) ===\n";
echo "total_staff: ".$org["total_staff"]."\n";
echo "active_staff: ".$org["active_staff"]."\n";
echo "absentees: ".$org["absentees"]."\n";
echo "inactive_flagged: ".$org["inactive_flagged"]."\n";
echo "orders_received_today: ".$org["orders_received_today"]."\n";
echo "orders_delivered_today: ".$org["orders_delivered_today"]."\n";
echo "total_pending: ".$org["total_pending"]."\n";
echo "sla_breaches: ".$org["sla_breaches"]."\n";
echo "orders_received_week: ".$org["orders_received_week"]."\n";
echo "orders_delivered_week: ".$org["orders_delivered_week"]."\n";
echo "orders_received_month: ".$org["orders_received_month"]."\n";
echo "orders_delivered_month: ".$org["orders_delivered_month"]."\n";
echo "staff_with_overtime: ".$org["staff_with_overtime"]."\n";
echo "staff_under_target: ".$org["staff_under_target"]."\n";
echo "target_hit_rate: ".$org["target_hit_rate"]."\n";
echo "staff_with_targets: ".$org["staff_with_targets"]."\n";
echo "daily_capacity: ".$data["capacity_demand"]["daily_capacity"]."\n";
echo "utilization_rate: ".$data["utilization"]["utilization_rate"]."%\n";
echo "staff_with_wip: ".$data["utilization"]["staff_with_wip"]."\n";
echo "total_available: ".$data["utilization"]["total_available"]."\n";

echo "\n=== 7-DAY TREND (FRESH) ===\n";
foreach($data["trend_7d"] as $d) {
    echo $d["label"]." ".$d["date"]."  recv:".$d["received"]." del:".$d["delivered"]." rej:".$d["rejected"]."\n";
}

echo "\n=== FINANCIAL ===\n";
echo "revenue_approved: ".$data["financial"]["revenue_approved"]."\n";
echo "revenue_sent: ".$data["financial"]["revenue_sent"]."\n";
echo "revenue_pipeline: ".$data["financial"]["revenue_pipeline"]."\n";
echo "revenue_this_month: ".$data["financial"]["revenue_this_month"]."\n";
echo "total_invoices: ".$data["financial"]["total_invoices"]."\n";

echo "\n=== TURNAROUND (includes ".count($data["trend_7d"])." days) ===\n";
echo "avg_hours: ".$data["turnaround"]["avg_hours"]."\n";
echo "min_hours: ".$data["turnaround"]["min_hours"]." (NEGATIVE = data corruption)\n";
echo "max_hours: ".$data["turnaround"]["max_hours"]."\n";
echo "sample_size: ".$data["turnaround"]["sample_size"]."\n";

echo "\n=== QUALITY ===\n";
echo "qa_compliance_rate: ".$data["quality"]["qa_compliance_rate"]."%\n";
echo "total_qa_reviews: ".$data["quality"]["total_qa_reviews"]."\n";

echo "\n=== REJECTIONS ===\n";
echo "rework_rate: ".$data["rejections"]["rework_rate"]."%\n";
echo "rejected_week: ".$data["rejections"]["rejected_week"]."\n";
echo "rejected_month: ".$data["rejections"]["rejected_month"]."\n";

echo "\n=== ALERTS (".count($data["alerts"]).") ===\n";
foreach($data["alerts"] as $a) echo $a["type"].": ".$a["message"]."\n";

echo "\n=== TOP PERFORMERS ===\n";
foreach($data["top_performers"] as $p) echo $p["name"]."  done=".$p["completed"]."  avg_min=".$p["avg_minutes"]."\n";

echo "\n=== VERIFICATION CHECKS ===\n";
$trendRecvSum = array_sum(array_column($data["trend_7d"], "received"));
$trendDelSum = array_sum(array_column($data["trend_7d"], "delivered"));
echo "7d trend sum recv=$trendRecvSum del=$trendDelSum (should match ~week totals)\n";
echo "Week totals: recv=".$org["orders_received_week"]." del=".$org["orders_delivered_week"]."\n";
$match = abs($trendRecvSum - $org["orders_received_week"]) < ($org["orders_received_week"] * 0.05);
echo "MATCH (within 5%): ".($match ? "YES ✓" : "NO ✗ DISCREPANCY!")."\n";
