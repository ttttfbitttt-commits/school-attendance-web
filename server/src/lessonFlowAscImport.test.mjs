import test from 'node:test'
import assert from 'node:assert/strict'
import {handleLessonFlowRequest} from './lessonFlow.mjs'

async function run(teacherId) {
 const calls=[];let response
 const client={query:async (sql,params)=>{calls.push({sql,params});if(sql.includes('SELECT id,full_name,normalized_name FROM lesson_teachers'))return {rows:[{id:'teacher-a',full_name:'اسم المعلم',normalized_name:'اسم المعلم'}],rowCount:1};if(sql.includes('SELECT raw_name_normalized,teacher_id'))return {rows:[],rowCount:0};if(sql.includes('SELECT 1 FROM lesson_time_slots'))return {rows:[],rowCount:0};if(sql.includes('INSERT INTO lesson_schedule_imports'))return {rows:[{id:'import'}],rowCount:1};if(sql.includes('INSERT INTO lesson_classrooms'))return {rows:[{id:'class',name:'اول',normalized_name:'اول'}],rowCount:1};return {rows:[],rowCount:0}}}
 const ctx={req:{method:'POST'},res:{},url:{pathname:'/api/lesson-flow/schedule'},user:{role:'admin',school_id:'school-a',user_id:'user'},body:async()=>({classrooms:[{name:'اول'}],assignments:[{classroomName:'اول',weekday:1,periodNumber:1,subjectName:'علوم',rawTeacherName:'مختصر',...(teacherId ? {teacherId}: {})}],times:[]}),json:(_r,status,data)=>{response={status,data}},scoped:async (schoolId,fn)=>{assert.equal(schoolId,'school-a');return fn(client)}}
 await handleLessonFlowRequest(ctx);return {calls,response}
}
test('explicit selection is assigned to a teacher within the school',async()=>{const r=await run('teacher-a');assert.equal(r.response.status,200);const insert=r.calls.find(x=>x.sql.includes('INSERT INTO lesson_schedule_assignments'));assert.equal(insert.params[8],'teacher-a')})
test('teacher from another school is rejected before any schedule changes',async()=>{const r=await run('teacher-other-school');assert.equal(r.response.status,400);assert.equal(r.calls.some(x=>x.sql.includes('UPDATE lesson_schedule_imports')),false)})
test('existing import without teacher id remains supported',async()=>{const r=await run();assert.equal(r.response.status,200)})
