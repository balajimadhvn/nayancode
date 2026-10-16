# Data notice

The alignments in `data/` are exported unchanged (as FASTA) from public R data packages, which are distributed under
the GNU GPL; they are included here only as benchmark inputs and are not part of the Workbench:

- `woodmouse.fa.gz`: ape 5.8-1 (GPL-2 | GPL-3), dataset `woodmouse`, mitochondrial cytochrome b of 15 wood mice
  (*Apodemus sylvaticus*; Michaux et al. 2003, Molecular Ecology 12:685).
- `Laurasiatherian.fa.gz`, `chloroplast.fa.gz`, `yeast.fa.gz`: phangorn 2.12.1 (GPL ≥ 2), datasets of the same names.
  Laurasiatherian: RNA sequence data of 47 mammals, 3,179 sites, from the former repository of the Allan Wilson Centre.
  chloroplast: amino-acid alignment of 15 genes of 19 chloroplasts. yeast: 106 genes of 8 yeast species
  (Rokas et al. 2003, Nature 425:798).

See each package's documentation for the original sources. `ref/` holds results computed from these alignments with
IQ-TREE by `make-reference.sh`.
