"""Named schedule snapshots without nested history or attendance rollback."""
import copy,datetime,uuid
EXCLUDED={'savedSchedules','revision','absenceRecords','activeScheduleId','activeScheduleName','termWorkspaces','activeTermId','termVersion'}
def sync_schedule(project):
    if not project.get('placements'):return
    project.setdefault('savedSchedules',[])
    project.setdefault('activeScheduleId',uuid.uuid4().hex)
    project.setdefault('activeScheduleName','جدول 1')
    name=str(project['activeScheduleName']).strip()
    if not name or len(name)>100:raise ValueError('اسم الجدول مطلوب وبحد أقصى ١٠٠ حرف.')
    if any(v['id']!=project['activeScheduleId'] and v['name']==name for v in project['savedSchedules']):raise ValueError('يوجد جدول آخر بهذا الاسم. اختر اسمًا مختلفًا.')
    previous=next((v for v in project['savedSchedules'] if v['id']==project['activeScheduleId']),None)
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    item={'id':project['activeScheduleId'],'name':name,'snapshot':copy.deepcopy({k:v for k,v in project.items() if k not in EXCLUDED}),'createdAt':previous['createdAt'] if previous else now,'updatedAt':now}
    project['savedSchedules']=[v for v in project['savedSchedules'] if v['id']!=item['id']]+[item]
