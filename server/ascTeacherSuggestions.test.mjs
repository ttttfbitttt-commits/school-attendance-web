import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestAscTeachers } from '../src/ascTeacherSuggestions.ts'
const teachers=[{id:'1',name:'مسعد محمد سعيد البشري'},{id:'2',name:'علي محمد الزهراني'},{id:'3',name:'علي احمد الزهراني'},{id:'4',name:'أحمد سالم الحربي'}]
test('suggest only unique first and last name, handling Arabic variants',()=>{assert.deepEqual(suggestAscTeachers(['مسعد البشري','علي الزهراني','احمد الحربي','باسر الزبيدي'],teachers),{'مسعد البشري':'1','احمد الحربي':'4'})})
test('do not suggest when two source names map to one teacher',()=>{assert.deepEqual(suggestAscTeachers(['مسعد البشري','مسعد محمد البشري'],teachers),{})})
test('respect middle names and never match by spelling guess',()=>{assert.deepEqual(suggestAscTeachers(['علي محمد الزهراني','أحمد السلمي'],teachers),{'علي محمد الزهراني':'2'})})
