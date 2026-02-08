# Cost and Scaling Notes

## Main cost drivers
- CloudFront egress bandwidth (HLS segments dominate at scale).
- MediaConvert transcoding minutes and output complexity.
- S3 storage for originals + renditions + thumbnails.
- Lambda + Step Functions transitions for processing pipeline.
- DynamoDB write amplification from search/federation/view dedupe patterns.

## Scaling behavior
- API scales via Lambda concurrency.
- Pipeline scales with Step Functions + MediaConvert queue throughput.
- Notifications/federation scale with SQS consumer concurrency.

## Hot partition risks and mitigation
- View counters: mitigated by sharded counters (`VIEWCOUNT#0..19`).
- Global video feeds: use state GSI with time-ordered sort keys.
- Search token skew: restrict token cardinality and consider OpenSearch Serverless for large catalogs.

## MediaConvert optimization levers
- Reduce renditions/bitrates for lower transcode and storage costs.
- Use templates per profile (SD/HD/UHD tiers).
- Archive originals to lower S3 tiers after retention threshold.

## Recommended production budgets/alarms
- CloudFront monthly cost budget with anomaly alerts.
- MediaConvert spend alarm.
- S3 storage and request anomaly alarms.
- DynamoDB consumed write/request unit anomaly alarms.
