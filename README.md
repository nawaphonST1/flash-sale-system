# Flash Sale System

High-concurrency Flash Sale backend architecture built with **NestJS**, **PostgreSQL**, **Redis**, and **Nginx Load Balancer**.

---

## 🚀 1-Click Start (Quick Run)

เพื่อให้ระบบทั้งหมดเริ่มต้นทำงานแบบ Multi-Instance และพร้อมรับ Load Test ได้ทันที:

```bash
docker compose up --build -d
```

> **หมายเหตุ:** ระบบจะเริ่มต้น Services ทั้งหมดโดยอัตโนมัติ:
> * **Nginx Load Balancer:** `http://localhost:80`
> * **PostgreSQL Master:** `localhost:5433`
> * **Redis Server:** `localhost:6379`
> * **NestJS API Instances:** 6 Replicas (`auth-app-1` ถึง `auth-app-6`)
> * **Worker Service:** `worker-app-1` (ประมวลผลคำสั่งซื้อ BullMQ)
> * **Prometheus:** `http://localhost:9090`
> * **Grafana:** `http://localhost:3001` (User: `admin` / Pass: `admin`)

---

## 🛑 Stop System

```bash
docker compose down
```

หรือต้องการล้าง Volume ฐานข้อมูลทั้งหมด:
```bash
docker compose down -v
```

---

## ⚙️ Environment Variables

ระบบถูกตั้งค่าเริ่มต้น (Default Values) ไว้ใน [docker-compose.yml](file:///docker-compose.yml) เรียบร้อยแล้ว จึงสามารถรันได้ทันทีโดยไม่ต้องสร้างไฟล์ `.env` เพิ่มเติม

หากต้องการปรับแต่งค่าสำหรับการรัน Local สามารถคัดลอกจาก [.env.example](file:///.env.example):

```bash
cp .env.example .env
```
