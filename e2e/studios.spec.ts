import { expect, test, type Page } from '@playwright/test';

/** Collect page errors and console errors; ignore known third-party noise. */
function watch(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver|Failed to load resource.*(rcsb|ebi\.ac|ncbi|uniprot|opentargets|civicdb|myvariant|pubchem)/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  return errs;
}
const ROUTES: [string, RegExp][] = [['workbench', /Welcome/], ['lab', /Lab Studio/], ['sequence', /Sequence Studio/], ['phylogenetics', /Phylogenetics/], ['genome', /Genome Studio/], ['variants', /Variant Studio/], ['expression', /Expression Studio/], ['single-cell', /Single-Cell/], ['microbiome', /Microbiome Studio/], ['chemistry', /Chemistry Studio/], ['structure', /Structure Studio/], ['atlas', /Atlas/], ['report', /Report/], ['licenses', /Licences/], ['docking', /Docking Studio/], ['statistics', /Statistics Studio/], ['plasmid', /Plasmid Studio/], ['biologics', /Biologics Studio/], ['pharmacokinetics', /PK Studio/], ['trajectory', /Trajectory Studio/], ['peptides', /Peptide Studio/], ['population-genetics', /Population Genetics Studio/]];

test('every route loads in one session without errors or the error boundary', async ({ page }) => {
  const errs = watch(page); await page.goto('/'); await expect(page.locator('h1').first()).toContainText(/Welcome/);
  for (const [route, h1] of ROUTES) { await page.goto(`/${route}`); await expect(page.locator('h1').first()).toHaveText(h1, { timeout: 15_000 }); await expect(page.getByText('went wrong')).toHaveCount(0); await expect(page.getByText('could not be loaded')).toHaveCount(0); }
  expect(errs).toEqual([]);
});

test('direct deep-link loads of lazy studios work (cold navigation)', async ({ page }) => {
  const errs = watch(page);
  for (const r of ['phylogenetics', 'variants', 'single-cell', 'genome']) { await page.goto(`/${r}?cold=1`); await expect(page.locator('h1').first()).not.toHaveText(/^$/, { timeout: 15_000 }); await expect(page.getByText('went wrong')).toHaveCount(0); }
  expect(errs).toEqual([]);
});

test('expression: demo → DE → enrichment validates the planted pathway', async ({ page }) => {
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Load real-gene demo/ }).click(); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('tab', { name: 'Enrichment' }).click(); await page.getByRole('button', { name: 'Run enrichment' }).click();
  await expect(page.locator('.callout', { hasText: 'planted pathway' })).toContainText(/Interferon Signaling.{0,3} ranks #1 of/, { timeout: 40_000 });
  expect(errs).toEqual([]);
});

test('sequence: proteomics digest, isotope pattern and synthetic mzML run', async ({ page }) => {
  const errs = watch(page); await page.goto('/sequence');
  await page.getByRole('button', { name: 'Demo DNA' }).click(); await page.getByRole('tab', { name: 'Proteomics' }).click();
  await page.getByRole('button', { name: 'Digest', exact: true }).click(); await expect(page.getByText('Residues covered')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('cell', { name: 'VGAHAGEYGAEALER', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Mass & isotopes' }).click(); await expect(page.getByText('Monoisotopic mass')).toBeVisible(); await expect(page.getByText('Isotope pattern')).toBeVisible();
  await page.getByRole('tab', { name: 'mzML viewer' }).click(); await page.getByRole('button', { name: 'Load synthetic demo run' }).click(); await expect(page.getByText('Total ion chromatogram')).toBeVisible();
  expect(errs).toEqual([]);
});

test('sequence: primer design and Golden Gate demo work', async ({ page }) => {
  const errs = watch(page); await page.goto('/sequence');
  await page.getByRole('button', { name: 'Demo DNA' }).click(); await page.getByRole('tab', { name: 'Primer design' }).click(); await page.getByRole('button', { name: 'Design primers' }).click();
  await expect(page.getByText('Primer pairs')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Demo Golden Gate' }).click(); await page.getByRole('tab', { name: 'Golden Gate' }).click(); await page.getByRole('button', { name: 'Assemble' }).click();
  await expect(page.getByText(/Assembled product/)).toBeVisible({ timeout: 20_000 });
  expect(errs).toEqual([]);
});

test('genome: real minimap2 + samtools + bcftools recover planted SNVs and indels', async ({ page }) => {
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'Mapping & variants' }).click(); await page.getByRole('button', { name: /Demo: simulated/ }).click(); await page.getByRole('button', { name: 'Map & call' }).click();
  await expect(page.getByText(/8\/8 planted variants recovered, 0 false positive/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('cell', { name: 'deletion' }).first()).toBeVisible(); await expect(page.getByRole('cell', { name: 'insertion' })).toBeVisible();
  // Haploid calling runs (the 40 % allele is a mixture, so a haploid caller may genotype it as reference).
  await page.locator('label.field', { hasText: 'Ploidy' }).locator('select').selectOption('1'); await page.getByRole('button', { name: 'Map & call' }).click();
  await expect(page.getByText(/[78]\/8 planted variants recovered, 0 false positive/)).toBeVisible({ timeout: 60_000 });
  // The built-in caller is SNV-only: it finds the 5 SNVs and none of the 3 indels.
  await page.locator('label.field', { hasText: 'Caller' }).locator('select').selectOption('builtin'); await page.getByRole('button', { name: 'Map & call' }).click();
  await expect(page.getByText(/5\/8 planted variants recovered, 0 false positive/)).toBeVisible({ timeout: 60_000 });
  expect(errs).toEqual([]);
});

test('phylogenetics: maximum likelihood with parallel bootstrap support', async ({ page }) => {
  const errs = watch(page); await page.goto('/phylogenetics');
  await page.getByRole('button', { name: /Demo: 12-protein family/ }).click(); await page.getByRole('button', { name: 'Run progressive alignment' }).click();
  await page.locator('label.field', { hasText: 'Method' }).locator('select').selectOption('ml');
  await page.locator('label.field', { hasText: 'Bootstrap replicates' }).locator('input[type=range]').fill('10');
  await expect(page.getByText(/Bootstrap replicates: 10 \(ML, in parallel on \d+ cores?\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Build tree' }).click();
  await expect(page.getByText(/12 tips · bootstrap 10/)).toBeVisible({ timeout: 80_000 });
  await expect(page.locator('.card', { hasText: 'Paste a Newick tree' }).locator('textarea')).toHaveValue(/\)\d{1,3}:/); // internal nodes carry support values
  expect(errs).toEqual([]);
});

test('figures: a phylogenetic tree exports to SVG with its tip labels', async ({ page }) => {
  const errs = watch(page); await page.goto('/phylogenetics');
  await page.getByRole('button', { name: /Demo: 12-protein family/ }).click(); await page.getByRole('button', { name: 'Run progressive alignment' }).click();
  await page.getByRole('button', { name: 'Build tree' }).click();
  await expect(page.getByText(/12 tips/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Export figure tree' }).click();
  const panel = page.getByRole('group', { name: 'Figure export options' });
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'SVG', exact: true }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^solagene-nayancode_tree_\d{4}-\d{2}-\d{2}\.svg$/);
  const svg = (await import('node:fs')).readFileSync((await dl.path())!, 'utf8');
  expect(svg).toContain('<svg'); expect(svg).toContain('<text');
  expect((svg.match(/id="tip-/g) ?? []).length).toBe(12);
  expect(errs).toEqual([]);
});

test('sequence: protein language model tab opens with warning and load button', async ({ page }) => {
  const errs = watch(page); await page.goto('/sequence');
  await page.getByRole('button', { name: 'Demo proteins' }).click();
  await page.getByRole('tab', { name: 'Protein language model' }).click();
  await expect(page.getByText('Experimental. Uses an 8-million-parameter ESM-2 model')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load model (~30 MB)' })).toBeVisible();
  expect(errs).toEqual([]);
});

test('sequence: protein language model scores ubiquitin L8I above L8D in the browser (live model, needs network)', async ({ page }) => {
  test.skip(!process.env.RUN_PLM_NETWORK_TEST, 'downloads ~30 MB from huggingface.co; run with RUN_PLM_NETWORK_TEST=1');
  test.setTimeout(240_000);
  const errs = watch(page); await page.goto('/sequence');
  await page.getByRole('button', { name: 'Demo proteins' }).click(); await page.getByRole('tab', { name: 'Protein language model' }).click();
  await page.getByRole('button', { name: 'Example: ubiquitin' }).click(); await page.getByRole('button', { name: 'Load model (~30 MB)' }).click();
  await expect(page.getByRole('button', { name: 'Scan all substitutions' })).toBeEnabled({ timeout: 200_000 });
  await page.getByRole('button', { name: 'Scan all substitutions' }).click(); await expect(page.getByText('Pseudo-perplexity')).toBeVisible({ timeout: 120_000 });
  const rows = page.locator('table').first().locator('tbody tr'); const val = async (i: number) => Number((await rows.nth(i).locator('td').nth(1).innerText()).replace('−', '-'));
  const d = await val(0), ile = await val(1); expect(ile).toBeGreaterThan(d);
  expect(errs.filter((e) => !/huggingface|cdn-lfs|hf\.co/i.test(e))).toEqual([]);
});

test('structure: 1HSG interaction profile reproduces Asp25 hydrogen bonds', async ({ page }) => {
  await page.goto('/structure'); await expect(page.getByRole('button', { name: 'Load structure' })).toBeEnabled({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Load structure' }).click(); await expect(page.getByText(/Structure analysis/)).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Profile interactions' }).click();
  await expect(page.locator('table.t tbody tr', { hasText: 'ASP 25' }).first()).toBeVisible({ timeout: 20_000 }); await expect(page.getByText(/hydrogen bond · \d+/)).toBeVisible();
});

test('structure: analysis tools show a contact map and normal modes for 1HSG', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/structure'); await expect(page.getByRole('button', { name: 'Load structure' })).toBeEnabled({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Load structure' }).click(); await expect(page.getByText(/Structure analysis/)).toBeVisible({ timeout: 40_000 });
  await page.getByRole('tab', { name: 'Analysis tools' }).click();
  await expect(page.getByText(/Contact map · Cα/)).toBeVisible();
  await page.getByRole('tab', { name: 'Modes' }).click();
  await expect(page.getByText(/Slowest non-zero modes ·/)).toBeVisible({ timeout: 120_000 });
  expect(errs).toEqual([]);
});

test('chemistry: worker processes the example library; QSAR tab renders', async ({ page }) => {
  const errs = watch(page); await page.goto('/chemistry'); await expect(page.getByRole('button', { name: /Load example/ })).toBeEnabled({ timeout: 40_000 });
  await page.getByRole('button', { name: /Load example/ }).click(); await expect(page.locator('.mol-card').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'ADMET' }).click(); await expect(page.getByText('Per-compound predictions')).toBeVisible({ timeout: 15_000 }); await expect(page.getByText(/Lipinski pass/)).toBeVisible();
  await page.getByRole('tab', { name: 'Molecule tools' }).click(); await page.getByRole('button', { name: 'Analyse' }).click(); await expect(page.getByText(/scaffolds for \d+ molecules/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'MCS & R-groups' }).click(); await page.getByRole('button', { name: 'Find common core' }).click(); await expect(page.getByText(/Common core: \d+ atoms/)).toBeVisible({ timeout: 45_000 });
  await page.locator('.card', { hasText: 'R-group decomposition' }).locator('input').fill('c1ccccc1'); await page.getByRole('button', { name: 'Decompose the library' }).click(); await expect(page.getByText('R-group table')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Pharmacophore & shape' }).click(); await page.getByRole('button', { name: 'Rank the library' }).click(); await expect(page.getByText('Most similar')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Reaction enumeration' }).click(); await page.getByRole('button', { name: 'Enumerate products' }).click(); await expect(page.getByText(/\d+ products/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'QSAR Lab' }).click(); await expect(page.getByText('1 · Dataset')).toBeVisible();
  expect(errs).toEqual([]);
});

test('microbiome: UniFrac with the demo tree finds the treatment effect', async ({ page }) => {
  const errs = watch(page); await page.goto('/microbiome'); await page.getByRole('button', { name: /Load synthetic demo/ }).click();
  await page.locator('label.field', { hasText: 'Beta metric' }).locator('select').selectOption('unifrac-weighted'); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText(/p = 0\.00\d/)).toBeVisible({ timeout: 40_000 });
  expect(errs).toEqual([]);
});

test('genome: assembly demo builds contigs from simulated lambda reads', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: /Demo: 60× simulated phage lambda/ }).click();
  await expect(page.getByText('N50')).toBeVisible({ timeout: 150_000 });
  await expect(page.locator('.stat', { hasText: 'Contigs' }).first()).not.toContainText('0');
  expect(errs).toEqual([]);
});

test('microbiome: reference screening of the lambda + T7 demo reports both phages', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/microbiome');
  await page.getByRole('tab', { name: 'Reference screening' }).click();
  await page.getByRole('button', { name: /Demo: 70 % lambda/ }).click();
  await expect(page.getByRole('cell', { name: 'lambda', exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('cell', { name: 't7', exact: true })).toBeVisible();
  expect(errs).toEqual([]);
});

test('single-cell: demo recovers four clusters', async ({ page }) => {
  const errs = watch(page); await page.goto('/single-cell'); await page.getByRole('button', { name: /Run synthetic PBMC-like demo/ }).click();
  await expect(page.getByText('Cells kept')).toBeVisible({ timeout: 60_000 }); await expect(page.locator('.stat', { hasText: 'Clusters' }).first()).toContainText('4');
  expect(errs).toEqual([]);
});

test('report: a captured figure appears in the report with Methods', async ({ page }) => {
  await page.goto('/expression'); await page.getByRole('button', { name: /Load synthetic demo/ }).click(); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 }); await page.getByLabel('Add figure to report').first().click();
  await expect(page.locator('.toast')).toContainText(/Added 1 figure/);
  // Navigate the way a user does (sidebar link), then reload to prove the figure was persisted to IndexedDB.
  await page.getByRole('link', { name: 'Report' }).click(); await expect(page.locator('.card.card-pad img').first()).toBeVisible(); await expect(page.getByText(/median-of-ratios/)).toBeVisible();
  await page.reload(); await expect(page.locator('.card.card-pad img').first()).toBeVisible();
});

test('expression: batch-effect demo runs ComBat and offers corrected PCA', async ({ page }) => {
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Load batch-effect demo/ }).click(); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('tab', { name: 'PCA' }).click();
  await expect(page.getByText(/after ComBat/)).toBeVisible(); await expect(page.getByText(/2 batches detected/)).toBeVisible();
  await page.locator('select').filter({ hasText: 'Uncorrected' }).selectOption('raw'); await expect(page.getByText(/before ComBat/)).toBeVisible();
  expect(errs).toEqual([]);
});

test('expression: paired design, F-test and design errors', async ({ page }) => {
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Load paired demo/ }).click();
  await expect(page.getByText(/~ treatment \+ donor · 6 coefficients · 6 residual df/)).toBeVisible();
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.locator('.callout', { hasText: 'Validation against planted truth' })).toContainText(/sensitivity (8\d|9\d)%/, { timeout: 40_000 });
  await page.locator('label.field', { hasText: 'Question' }).locator('select').selectOption('anova'); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText(/any difference between treatment levels/)).toBeVisible({ timeout: 40_000 }); await expect(page.getByRole('columnheader', { name: 'F', exact: true })).toBeVisible();
  await page.getByLabel('Use treatment in the model').uncheck(); await expect(page.locator('.callout', { hasText: 'must be in the design' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
  expect(errs).toEqual([]);
});

test('import wizard: nf-core/rnaseq merged counts flow into Expression Studio', async ({ page }) => {
  const errs = watch(page); await page.goto('/import');
  let s = 5; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rows = ['gene_id\tgene_name\tWT_REP1\tWT_REP2\tWT_REP3\tKO_REP1\tKO_REP2\tKO_REP3'];
  for (let g = 0; g < 400; g++) rows.push(`ENSG${g}\tGENE${g}\t` + Array.from({ length: 6 }, (_, j) => Math.round((50 + r() * 200) * (g < 40 && j >= 3 ? 3 : 1))).join('\t'));
  await page.locator('input[type=file]').setInputFiles({ name: 'salmon.merged.gene_counts.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from(rows.join('\n')) });
  await expect(page.getByText('RNA-seq counts').first()).toBeVisible(); await expect(page.getByPlaceholder('group, e.g. control').first()).toHaveValue('WT');
  await page.getByRole('button', { name: 'Open in Expression Studio' }).click();
  await expect(page.locator('h1').first()).toHaveText(/Expression Studio/); await expect(page.getByText(/Counts loaded \(400 genes\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Run analysis' }).click(); await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 });
  expect(errs).toEqual([]);
});

test('import wizard: gzipped 10x triplet flows into Single-Cell Studio', async ({ page }) => {
  const errs = watch(page); await page.goto('/import');
  const { gzipSync } = await import('node:zlib');
  const mtx = '%%MatrixMarket matrix coordinate integer general\n3 4 6\n1 1 5\n2 1 2\n2 2 4\n3 3 1\n1 4 2\n3 4 6\n';
  await page.locator('input[type=file]').setInputFiles([
    { name: 'matrix.mtx.gz', mimeType: 'application/gzip', buffer: gzipSync(mtx) },
    { name: 'features.tsv.gz', mimeType: 'application/gzip', buffer: gzipSync('g1\tA\ng2\tB\ng3\tC\n') },
    { name: 'barcodes.tsv.gz', mimeType: 'application/gzip', buffer: gzipSync('b1\nb2\nb3\nb4\n') },
  ]);
  await page.getByRole('button', { name: 'Open in Single-Cell Studio' }).click();
  await expect(page.locator('h1').first()).toHaveText(/Single-Cell/); await expect(page.getByText(/Loaded: matrix\.mtx/)).toBeVisible();
  expect(errs).toEqual([]);
});

test('figures: a volcano plot exports to SVG, PDF and 600 dpi PNG with labelled top genes', async ({ page }) => {
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Load real-gene demo/ }).click(); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Export figure volcano' }).click();
  const panel = page.getByRole('group', { name: 'Figure export options' });
  await panel.getByLabel('Title').fill('Demo volcano'); await panel.getByLabel('Label top N genes').fill('8');
  const save = async (name: string) => { const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name, exact: true }).click()]); return dl; };
  const svgDl = await save('SVG'); expect(svgDl.suggestedFilename()).toMatch(/^solagene-nayancode_demo-volcano_\d{4}-\d{2}-\d{2}\.svg$/);
  const svg = (await import('node:fs')).readFileSync((await svgDl.path())!, 'utf8');
  expect(svg).toContain('<svg'); expect(svg).toContain('Demo volcano'); expect(svg).not.toMatch(/var\(--/); expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(100); expect((svg.match(/id="gene-label"/g) ?? []).length).toBe(8);
  const pdfDl = await save('PDF'); const pdf = (await import('node:fs')).readFileSync((await pdfDl.path())!, 'latin1'); expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf).toContain('%%EOF');
  const pngDl = await save('PNG 600 dpi'); const png = (await import('node:fs')).readFileSync((await pngDl.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG'); expect(png.readUInt32BE(16)).toBe(Math.round(114 / 25.4 * 600)); expect(png.readUInt32BE(20)).toBe(Math.round(80 / 25.4 * 600));
  expect(errs).toEqual([]);
});

test('lab: Livak 2001 example, dose–response fit and a power calculation', async ({ page }) => {
  const errs = watch(page); await page.goto('/lab');
  await page.getByRole('button', { name: 'Livak 2001 example' }).click(); await page.getByRole('button', { name: 'Calculate' }).click();
  const table = page.locator('table').first(); await expect(table).toContainText('kidney', { timeout: 15_000 }); await expect(table).toContainText('-2.5'); await expect(table).toContainText('5.6');
  await page.getByRole('button', { name: 'Demo', exact: true }).click(); await page.getByRole('button', { name: 'Fit', exact: true }).click(); await expect(page.getByText(/Efficiency/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Dose–response' }).click(); await page.getByRole('button', { name: /Load demo/ }).click(); await page.getByRole('button', { name: 'Fit curves' }).click();
  await expect(page.getByRole('cell', { name: 'Cmpd A' })).toBeVisible({ timeout: 15_000 }); await expect(page.getByRole('cell', { name: 'Cmpd B' })).toBeVisible();
  await page.getByRole('tab', { name: 'Power & sample size' }).click(); await page.getByLabel('Power', { exact: true }).fill('0.8');
  await expect(page.locator('.stat').first()).toContainText(/\d+/); // two-sample t, d = 0.625 → n per group 42
  await expect(page.locator('.stat .v').first()).toHaveText('42');
  expect(errs).toEqual([]);
});

test('lab: survival demo gives Kaplan–Meier medians, log-rank and a Cox hazard ratio', async ({ page }) => {
  const errs = watch(page); await page.goto('/lab');
  await page.getByRole('tab', { name: 'Survival' }).click(); await page.getByRole('button', { name: /Load demo/ }).click(); await page.getByRole('button', { name: 'Analyse' }).click();
  await expect(page.getByText('Cox proportional hazards')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Log-rank χ² = 3\.396/)).toBeVisible(); await expect(page.getByRole('cell', { name: '2.498' })).toBeVisible();
  expect(errs).toEqual([]);
});

test('expression: the network tab draws pathway co-membership hubs for the real-gene demo', async ({ page }) => {
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Load real-gene demo/ }).click(); await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('tab', { name: 'Network' }).click();
  await expect(page.getByText('Hubs')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: /Gene network of \d+ genes and \d+ edges/ })).toBeVisible();
  await expect(page.getByText(/colour = Louvain community/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch STRING interactions' })).toBeVisible();
  expect(errs).toEqual([]);
});

test('variants: association testing recovers planted variants and draws Manhattan and QQ plots', async ({ page }) => {
  const errs = watch(page); await page.goto('/variants');
  await page.getByRole('tab', { name: 'Association' }).click(); await page.getByRole('button', { name: /Demo: case\/control/ }).click(); await page.getByRole('button', { name: 'Run association' }).click();
  await expect(page.getByText('Manhattan plot')).toBeVisible({ timeout: 60_000 }); await expect(page.getByText('Variants tested')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'λ GC' }).locator('.v')).toContainText(/^\d\.\d+/);
  expect(await page.getByRole('cell', { name: /★/ }).count()).toBeGreaterThanOrEqual(2);
  expect(errs).toEqual([]);
});

test('single-cell: two-batch demo integrates batches and scores planted doublets', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/single-cell');
  await page.getByRole('button', { name: /Run demo: 2 batches/ }).click();
  await expect(page.getByText(/UMAP embedding/)).toBeVisible({ timeout: 150_000 });
  await page.getByRole('tab', { name: 'QC' }).click(); await expect(page.getByText('Doublet scores')).toBeVisible(); await expect(page.getByText(/neighbourhood batch mixing/)).toBeVisible();
  await page.getByRole('tab', { name: 'Embedding' }).click(); await page.locator('select').filter({ hasText: 'colour: batch' }).selectOption('batch'); await expect(page.locator('canvas').first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('expression: pseudoalignment demo quantifies six synthetic samples and hands the counts to the DE workflow', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Demo: 6 synthetic samples/ }).click();
  await expect(page.getByText(/Index: 60 transcripts/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('cell', { name: 'ctrl1' })).toBeVisible();
  await page.getByRole('button', { name: 'Use as count matrix below' }).click();
  await expect(page.getByText(/Counts loaded \(60 genes\)/)).toBeVisible();
  expect(errs).toEqual([]);
});

test('docking: 1HSG + indinavir demo docks with Vina in WebAssembly and reports RMSD to the crystal pose', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const errs = watch(page); await page.goto('/docking');
  await page.getByRole('button', { name: /Demo: HIV protease/ }).click();
  await expect(page.getByText(/1HSG \(bundled copy\)/)).toBeVisible({ timeout: 20_000 });
  await page.locator('label.field', { hasText: 'Exhaustiveness' }).locator('input[type=range]').fill('1');
  await page.getByRole('button', { name: 'Dock', exact: true }).click();
  await expect(page.getByText('Top pose < 2 Å from crystal')).toBeVisible({ timeout: 6 * 60_000 });
  await expect(page.getByRole('columnheader', { name: /RMSD to crystal/ }).first()).toBeVisible();
  const aff = await page.locator('table').first().locator('tbody tr').first().locator('td').nth(1).innerText();
  expect(Number(aff)).toBeLessThan(-7);
  await page.getByRole('button', { name: /Interaction profile of pose 1/ }).click();
  await expect(page.getByText(/hydrogen bond/).first()).toBeVisible({ timeout: 30_000 });
  expect(errs).toEqual([]);
});

test('lab: enzyme kinetics, plate reader and growth-curve demos all compute a result', async ({ page }) => {
  const errs = watch(page); await page.goto('/lab');
  await page.getByRole('tab', { name: 'Enzyme kinetics' }).click();
  await page.getByRole('button', { name: /Load demo \(Michaelis/ }).click();
  await expect(page.getByText('Vmax').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Km').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Plate reader' }).click();
  await page.getByRole('button', { name: 'Load demo plate' }).click();
  await expect(page.getByText('Standard curve').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('LOD (concentration)')).toBeVisible();
  await page.getByRole('tab', { name: 'Growth curves' }).click();
  await page.getByRole('button', { name: /Load demo \(two strains\)/ }).click();
  await expect(page.getByText(/Doubling time ·/).first()).toBeVisible({ timeout: 20_000 });
  expect(errs).toEqual([]);
});

test('statistics: meta-analysis demo pools the BCG trials and draws a forest plot', async ({ page }) => {
  const errs = watch(page); await page.goto('/statistics');
  await page.getByRole('tab', { name: 'Meta-analysis' }).click();
  await page.getByRole('button', { name: /Load demo \(BCG/ }).click();
  await expect(page.getByText('Forest plot')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pooled effect')).toBeVisible();
  await expect(page.getByText('0.71', { exact: false }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Compare groups' }).click();
  await page.getByRole('button', { name: /Load demo \(two groups\)/ }).click();
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByText('Welch t p')).toBeVisible({ timeout: 20_000 });
  expect(errs).toEqual([]);
});

test('plasmid: pUC19 demo annotates AmpR and draws the circular map', async ({ page }) => {
  const errs = watch(page); await page.goto('/plasmid');
  await page.getByRole('button', { name: /Load pUC19 demo/ }).click();
  await expect(page.getByText('2,686 bp').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('AmpR').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Restriction map' }).click();
  await expect(page.getByText(/Fragments \(bp, largest first\)/)).toBeVisible();
  await page.getByRole('tab', { name: 'Primers & checks' }).click();
  await page.getByRole('button', { name: 'Find binding sites' }).click();
  await expect(page.getByText('Binding sites').first()).toBeVisible({ timeout: 20_000 });
  expect(errs).toEqual([]);
});

test('biologics: trastuzumab demo finds the CDRs and screens liabilities', async ({ page }) => {
  const errs = watch(page); await page.goto('/biologics');
  await page.getByRole('button', { name: 'Load trastuzumab' }).click();
  await expect(page.getByText('CDR1').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('DTYIH').first()).toBeVisible();
  await expect(page.getByText(/VH ·/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Developability' }).click();
  await expect(page.getByText('Theoretical pI')).toBeVisible();
  await expect(page.getByText('Sequence liabilities').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Compare' }).click();
  await page.getByRole('button', { name: 'Demo (two VH)' }).click();
  await expect(page.getByText('trastuzumab').first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('pk: IV demo gives an AUCinf and the simulator and dosing tabs run', async ({ page }) => {
  const errs = watch(page); await page.goto('/pharmacokinetics');
  await page.getByRole('button', { name: 'Load IV demo' }).click();
  await page.getByRole('button', { name: 'Analyse' }).click();
  await expect(page.getByText('AUCinf', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('CL', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Simulate' }).click();
  await expect(page.getByText(/Cmax/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Dosing regimens' }).click();
  await expect(page.getByText('Accumulation ratio R')).toBeVisible();
  expect(errs).toEqual([]);
});

test('trajectory: demo gives RMSD and PC1 and the landscape tab draws', async ({ page }) => {
  const errs = watch(page); await page.goto('/trajectory');
  await page.getByRole('button', { name: 'Load demo trajectory' }).click();
  await expect(page.getByText(/RMSD/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/PC1/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Energy landscape' }).click();
  await expect(page.getByText(/Free-energy landscape/).first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('peptide: demo gives properties, a helical wheel and an AMP score', async ({ page }) => {
  const errs = watch(page); await page.goto('/peptides');
  await page.getByRole('button', { name: /Load demo/ }).click();
  await expect(page.getByText(/Hydrophobic moment/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'Helical wheel' }).click();
  await expect(page.getByText(/⟨μH⟩/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Fragments & masses' }).click();
  await expect(page.getByText(/Mass list/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'AMP screen' }).click();
  await expect(page.getByText(/not trained or validated/).first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('popgen: demo genotype table gives Fst and a Hardy–Weinberg table', async ({ page }) => {
  const errs = watch(page); await page.goto('/population-genetics');
  await page.getByRole('button', { name: 'Load demo table' }).click();
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByText(/Fst \(WC\)/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Frequencies and Hardy–Weinberg/).first()).toBeVisible();
  expect(errs).toEqual([]);
});
