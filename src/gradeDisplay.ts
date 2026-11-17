export function gradeDisplayName(grade: string, aliases: Record<string, string>): string {
  return aliases[grade]?.trim() || grade
}

export function assignedGradeLabel(grade: string, aliases: Record<string, string>, studentCount: number | undefined): string {
  const label = gradeDisplayName(grade, aliases)
  if (studentCount === 0) return `${label} (لا يوجد طلاب مرتبطون — القيمة الأصلية: ${grade})`
  return label
}
