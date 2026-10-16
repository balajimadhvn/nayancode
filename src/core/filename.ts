/**
 * Every file the Workbench saves is named `solagene-nayancode_<name>_<YYYY-MM-DD>.<ext>`, so downloads are
 * recognisable and sort by date. Names that already carry the prefix are left alone.
 */
export const FILE_PREFIX = 'solagene-nayancode';

export function brandedName(name: string, date = new Date()): string {
  if (name.startsWith(FILE_PREFIX)) return name;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  // Keep compound extensions such as .bam.bai and .nii.gz together.
  const m = name.match(/^(.*?)((?:\.[A-Za-z0-9]{1,5}){1,2})$/);
  const stem = (m ? m[1] : name).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
  return `${FILE_PREFIX}_${stem}_${day}${m ? m[2] : ''}`;
}
