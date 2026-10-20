import pg from 'pg'
import sharp from 'sharp'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const OUTPUT_LIMIT_BYTES = 1_000_000
const BATCH_SIZE = 8
const outputProfiles = [
  [1600, 80],
  [1280, 76],
  [1024, 72],
  [800, 68],
  [640, 62],
  [512, 56],
]

const extensionlessName = value => String(value || 'صورة-إنجاز').replace(/\.[^.]+$/, '').trim() || 'صورة-إنجاز'

async function webpUnderLimit(input) {
  let smallest = null
  for (const [size, quality] of outputProfiles) {
    const output = await sharp(input, { limitInputPixels: 30_000_000, failOn: 'none' })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer()
    if (!smallest || output.length < smallest.length) smallest = output
    if (output.length <= OUTPUT_LIMIT_BYTES) return output
  }
  return smallest
}

const pool = new Pool({ connectionString: databaseUrl })
const totals = { scanned: 0, compressed: 0, skipped: 0, failed: 0, before: 0, after: 0 }

try {
  let offset = 0
  while (true) {
    const { rows } = await pool.query(`SELECT school_id,student_id,assignment_id,slot_number,file_data,file_name,file_type
      FROM student_portfolio_files
      WHERE file_type IN ('image/png','image/jpeg','image/webp')
      ORDER BY school_id,student_id,assignment_id,slot_number
      LIMIT $1 OFFSET $2`, [BATCH_SIZE, offset])
    if (!rows.length) break
    offset += rows.length
    for (const file of rows) {
      totals.scanned += 1
      try {
        const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(file.file_data || ''))
        if (!match) throw new Error('invalid_image_data')
        const original = Buffer.from(match[1], 'base64')
        if (!original.length) throw new Error('empty_image_data')
        const optimized = await webpUnderLimit(original)
        if (!optimized?.length || optimized.length >= original.length) {
          totals.skipped += 1
          continue
        }
        const updatedData = `data:image/webp;base64,${optimized.toString('base64')}`
        const updatedName = `${extensionlessName(file.file_name)}.webp`
        const result = await pool.query(`UPDATE student_portfolio_files
          SET file_data=$1,file_name=$2,file_type='image/webp',uploaded_at=uploaded_at
          WHERE school_id=$3 AND student_id=$4 AND assignment_id=$5 AND slot_number=$6 AND file_data=$7`, [
          updatedData, updatedName, file.school_id, file.student_id, file.assignment_id, file.slot_number, file.file_data,
        ])
        if (result.rowCount) {
          totals.compressed += 1
          totals.before += original.length
          totals.after += optimized.length
        } else totals.skipped += 1
      } catch (error) {
        totals.failed += 1
        console.error(`portfolio_image_failed school=${file.school_id} student=${file.student_id} slot=${file.slot_number}: ${error instanceof Error ? error.message : 'unknown_error'}`)
      }
    }
    console.log(JSON.stringify({ ...totals, saved: totals.before - totals.after }))
  }
  console.log(JSON.stringify({ status: 'completed', ...totals, saved: totals.before - totals.after }))
} finally {
  await pool.end()
}
