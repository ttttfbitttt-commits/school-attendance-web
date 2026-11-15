export type TeacherSuggestion = { id: string; name: string }
const tokens = (value: string) => value.normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(token => token && !['بن','ابن','بنت'].includes(token))

// Only exact full names or unique first-and-last names qualify. Never guess
// from edit distance; conflicting imported names remain for manual review.
export function suggestAscTeachers(names: string[], teachers: TeacherSuggestion[]): Record<string, string> {
  const proposed = new Map<string, string>()
  for (const name of names) {
    const parts=tokens(name); if(parts.length<2) continue
    const matches=teachers.filter(teacher=>{
      const target=tokens(teacher.name)
      if(target.length<2 || parts[0]!==target[0] || parts[parts.length-1]!==target[target.length-1]) return false
      let index=1
      for(const part of parts.slice(1,-1)) { const found=target.indexOf(part,index); if(found<0 || found>=target.length-1) return false; index=found+1 }
      return true
    })
    if(matches.length===1) proposed.set(name,matches[0].id)
  }
  const counts=new Map<string,number>()
  for(const id of proposed.values()) counts.set(id,(counts.get(id)||0)+1)
  return Object.fromEntries([...proposed].filter(([,id])=>counts.get(id)===1))
}
