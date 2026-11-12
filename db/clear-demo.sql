-- 실제 주문을 받기 시작하기 전에 예시 데이터를 지운다. 서비스(한국·일본·티켓)와 계산기 설정은 남긴다.
--   배포 DB에 실행:  npx wrangler d1 execute nuhunie --remote --file db/clear-demo.sql
-- 되돌릴 수 없다. 실행 전에 관리자 화면에서 CSV를 내려받아 둔다.
DELETE FROM order_flags;
DELETE FROM orders;
DELETE FROM batches;
DELETE FROM vouchers;
DELETE FROM hits;
DELETE FROM audit;
