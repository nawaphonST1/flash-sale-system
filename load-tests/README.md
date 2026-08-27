# คู่มือการทดสอบ Load Test ด้วย k6 และการใช้งาน Observability

## 1. สิ่งที่เตรียมไว้ให้ในระบบ

1. **k6 Script (`load-tests/flash-sale-load-test.js`)**:
   - **Preparation Phase (Setup)**: วนลูปขอ JWT Token 500 คน (`user-1` ถึง `user-500`) จาก `/api/v1/auth/token`
   - **Read Load Scenario**: ยิง `GET /api/v1/products?page=1&limit=10` ด้วย 1,000 Concurrent VUs เป็นเวลา 30 วินาที
   - **Write Load Scenario**: ยิง `POST /api/v1/orders` ด้วย 500 Concurrent VUs เพื่อแย่งซื้อ `p-1001` โดยใช้ JWT ของ User แต่ละคน พร้อมจำลองส่ง request เบิ้ลพร้อมกัน (Duplicate/Burst 2-3 requests) เพื่อทดสอบ Lock ป้องกันสิทธิ์ซ้ำซ้อน
   - **Metrics พิเศษ**: บันทึก `orders_success_count`, `orders_rejected_count`, `orders_duplicate_blocked_count`, `order_placement_duration`
2. **Observability Stack (`docker-compose.yml`)**:
   - **Prometheus**: รันที่ Port `9090` ดึง metrics จาก Backend ทุก instance ผ่าน `/metrics`
   - **Grafana**: รันที่ Port `3001` (User: `admin` / Pass: `admin`) เพื่อใช้ดู realtime dashboard

---

## 2. วิธีการรันระบบและ Observability

> **ข้อเตือนใจ**: อย่าลืมเปิดโปรแกรม **Docker Desktop** ก่อนสั่งรันคำสั่ง Docker ครับ

เมื่อเปิด Docker Desktop เรียบร้อยแล้ว ให้รันคำสั่ง:
```bash
docker-compose up --build -d
```

### การเข้าใช้งาน Observability:
- **NestJS Metrics**: [http://localhost/metrics](http://localhost/metrics) หรือ [http://localhost:3000/metrics](http://localhost:3000/metrics)
- **Prometheus UI & Targets**: [http://localhost:9090/targets](http://localhost:9090/targets)
- **Grafana UI**: [http://localhost:3001](http://localhost:3001) (ล็อกอินด้วย `admin` / `admin`)
  - ให้เพิ่ม Data Source เป็น Prometheus โดยใส่ URL: `http://prometheus:9090`
  - สามารถ Import Dashboard ยอดนิยมสำหรับ NodeJS (เช่น Dashboard ID: `11159` หรือ `16281`) เพื่อดู CPU, Memory, Event Loop Lag, Request Rate และ Latency แบบ Real-time

---

## 3. วิธีการรัน k6 Load Test

### การติดตั้ง k6 (หากยังไม่มี):
- **Windows (Winget)**:
  ```powershell
  winget install k6 --source winget
  ```
- **Windows (Chocolatey)**:
  ```powershell
  choco install k6
  ```

---

### คำสั่งรัน Load Test:

#### ก. ยิงทดสอบระบบตัวเอง (Localhost Nginx LB):
```bash
k6 run load-tests/flash-sale-load-test.js
```

#### ข. ยิงทดสอบระบบผู้อื่น (ระบุ BASE_URL หรือ IP):
```bash
k6 run -e BASE_URL=http://<IP-OR-DOMAIN> load-tests/flash-sale-load-test.js
```

#### ค. กำหนด Product ID หรือจำนวนผู้ใช้เพิ่มเติมได้ตามต้องการ:
```bash
k6 run -e BASE_URL=http://localhost -e TOTAL_USERS=500 -e PRODUCT_ID=p-1001 load-tests/flash-sale-load-test.js
```
