# نشر الجدول الصوتي

هذه الخدمة مستقلة عن نظام الحصر حتى عند تشغيلها على الخادم نفسه.

- المشروع على الخادم: `/opt/soundtable`
- قاعدة البيانات: `/var/lib/soundtable/soundtable.sqlite3`
- منفذ داخلي: `127.0.0.1:8767`
- النطاق المقترح: `soundtable.7asr2030.com`
- ملف الأسرار على الخادم فقط: `/opt/soundtable/.env` (صلاحية 600)

## سجل DNS المطلوب

في لوحة DNS للنطاق `7asr2030.com` أضف:

```text
النوع: A
الاسم: soundtable
القيمة: 84.8.116.47
TTL: Automatic
```

بعد انتشار السجل، أصدر شهادة HTTPS:

```bash
sudo certbot --nginx -d soundtable.7asr2030.com
```

## تحديث لاحق

```bash
cd /opt/soundtable
sudo docker compose -f docker-compose.soundtable.yml up -d --build
sudo docker compose -f docker-compose.soundtable.yml ps
```

لا تستخدم قاعدة بيانات أو ملف `.env` الخاص بنظام الحصر مع هذه الخدمة.
