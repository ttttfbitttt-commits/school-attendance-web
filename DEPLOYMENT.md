# طريقة النشر المعتمدة

استخدم هذه الطريقة فقط لنشر تعديلات موقع `7asr2030.com`.

## المستودعات

- الفرع: `main`
- المستودع الذي يسحب منه الخادم: `backup-7asr2030`
- المستودع الاحتياطي المتزامن: `origin`
- لا تُضف صور المعاينة المحلية غير المتعقبة إلى أي commit.

## رفع التعديلات

بعد مراجعة التعديل وبنائه محليًا، ارفع الـ commit إلى المستودعين:

```powershell
git push backup-7asr2030 main
git push origin main
```

## النشر على الخادم

- المستخدم الصحيح: `ubuntu`
- المفتاح المحلي: `$env:USERPROFILE\.ssh\school-attendance-01`
- الخادم: `84.8.116.47`
- مجلد المشروع على الخادم: `/opt/7asr2030`

```powershell
ssh -i "$env:USERPROFILE\.ssh\school-attendance-01" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 ubuntu@84.8.116.47 "cd /opt/7asr2030 && git pull --ff-only && sudo docker compose up -d --build && git log --oneline -1 && sudo docker compose ps"
```

ينفذ الأمر السحب من `github-7asr` ثم يعيد بناء خدمتي الواجهة والخادم ويعرض آخر commit وحالة الحاويات.

## التحقق

بعد النشر، تحقق من أن `7asr2030-api-1` و`7asr2030-web-1` بحالة `Up`، ثم افتح الموقع وحدّث الصفحة تحديثًا كاملًا.

