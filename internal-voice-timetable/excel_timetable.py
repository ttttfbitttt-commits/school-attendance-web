"""Export weekly schedules to real Excel workbooks."""
import io
import re
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

KINDS={'teachers-general','classes-general','teachers-individual','classes-individual'}

def safe(value):
    text=str(value or '')
    return "'"+text if text.lstrip().startswith(('=','+','-','@')) else text

def export_timetable(project, kind):
    if kind not in KINDS or not project.get('placements'): raise ValueError('أنشئ الجدول أولًا.')
    slots=project.get('slots',[]); days=project.get('days',[])
    teachers={x['id']:x for x in project.get('teachers',[])}
    classes={x['id']:x for x in project.get('classes',[])}
    courses={x['id']:x for x in project.get('courses',[])}
    is_teacher=kind.startswith('teachers-'); general=kind.endswith('-general')
    owners=list(teachers.values()) if is_teacher else list(classes.values())
    lookup={}
    for pos in project['placements']:
        course=courses.get(pos.get('courseId')); slot=pos.get('slot')
        if not course or not isinstance(slot,int) or not 0<=slot<len(slots): raise ValueError('بيانات إحدى الحصص غير مكتملة.')
        owner=course.get('teacherId') if is_teacher else course.get('classId')
        key=(owner,slot)
        if key in lookup: raise ValueError('يوجد تعارض في الجدول. راجعه قبل التصدير.')
        lookup[key]=course
    w=Workbook(); w.remove(w.active)
    used=set()
    def sheet_name(name):
        base=re.sub(r'[\[\]:*?/\\]',' ',str(name or 'جدول')).strip()[:27] or 'جدول'; name=base; count=1
        while name.lower() in used:
            count+=1; name=base[:27]+str(count)
        used.add(name.lower()); return name
    def create(name):
        ws=w.create_sheet(sheet_name(name));ws.sheet_view.rightToLeft=True;ws.freeze_panes='B3';ws.sheet_properties.pageSetUpPr.fitToPage=True
        ws.page_setup.orientation='landscape';ws.page_setup.paperSize=ws.PAPERSIZE_A4;ws.page_setup.fitToWidth=1;ws.page_setup.fitToHeight=0
        return ws
    def content(course):
        if not course:return ''
        other=classes.get(course.get('classId'),{}) if is_teacher else teachers.get(course.get('teacherId'),{})
        return safe(str(course.get('subject') or '')+'\n'+str(other.get('name') or other.get('short') or ''))
    if general:
        ws=create('المعلمون' if is_teacher else 'الفصول');ws.cell(1,1,'المعلم' if is_teacher else 'الفصل'); ws.cell(2,1,'اليوم / الحصة')
        for j,slot in enumerate(slots,2):
            di=slot.get('day',-1); ws.cell(1,j,safe(days[di].get('name','') if isinstance(di,int) and 0<=di<len(days) else ''));ws.cell(2,j,int(slot.get('period',0))+1)
        for i,owner in enumerate(owners,3):
            ws.cell(i,1,safe(owner.get('name')))
            for j in range(len(slots)): ws.cell(i,j+2,content(lookup.get((owner['id'],j))))
    else:
        for owner in owners:
            ws=create(owner.get('name'));ws.cell(1,1,safe(owner.get('name')));ws.cell(2,1,'اليوم / الحصة')
            max_period=max((int(s.get('period',0)) for s in slots),default=-1)+1
            for period in range(max_period):ws.cell(2,period+2,period+1)
            for di,day in enumerate(days):
                ws.cell(di+3,1,safe(day.get('name')))
                for index,slot in enumerate(slots):
                    if slot.get('day')==di:ws.cell(di+3,int(slot.get('period',0))+2,content(lookup.get((owner['id'],index))))
    if not w.worksheets:raise ValueError('لا توجد بيانات للتصدير.')
    line=Side(style='thin',color='BED6D1')
    for ws in w:
        ws.column_dimensions['A'].width=27
        for col in range(2,ws.max_column+1):ws.column_dimensions[get_column_letter(col)].width=19
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True);cell.border=Border(left=line,right=line,top=line,bottom=line)
                if cell.row<=2 or cell.column==1:cell.fill=PatternFill('solid',fgColor='075B62');cell.font=Font(color='FFFFFF',bold=True)
            if row[0].row>2:ws.row_dimensions[row[0].row].height=38
    output=io.BytesIO();w.save(output);return output.getvalue()
