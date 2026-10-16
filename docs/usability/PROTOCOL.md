# Usability study protocol: Nayancode Workbench

Version 1.0 · 2026-10-15 · Principal investigator: Balaji Madhavan (Solagene, ORCID 0009-0007-8654-3864)

## 1. Aim
Measure whether researchers and students can complete standard bioinformatics analyses in the Nayancode Workbench
without installation or prior training, and how usable they find it. The results are reported in the software paper.

Questions:
1. What share of participants complete each task correctly without help (task success)?
2. How long does a first result take (time on task)?
3. How usable is the Workbench overall (System Usability Scale, SUS; Brooke 1996)?
4. Where do participants get stuck (observed problems, ranked by severity)?

## 2. Design
Single-session, task-based usability test with think-aloud, run in person or by video call with screen sharing.
About 45 minutes per participant. No comparison arm: SUS has published benchmarks (mean ≈ 68; Sauro & Lewis 2016),
and task success is reported with 95 % confidence intervals.

## 3. Participants
- **Group A, students:** 12–20 students from Vedicgen courses and partner colleges (biology, biotechnology or
  bioinformatics), with at most basic command-line experience.
- **Group B, researchers:** 5–10 external researchers (PhD students, post-docs, lab scientists) who analyse data
  as part of their work. Recruit at least half from outside Solagene and Vedicgen to limit bias.
- Inclusion: 18 or older; can use a laptop with Chrome, Edge or Firefox. Exclusion: anyone who helped build the
  Workbench.
- Sample size: 5 users find most usability problems (Nielsen 2000). 15 or more per group gives a usable SUS
  estimate (95 % CI roughly ±8 points) and task success rates with intervals of about ±20 percentage points.

## 4. Independence and consent
- Participation is voluntary. **For students, it must not affect course grades, certificates or fees.** The
  facilitator must not be the student's assessor, and the invitation must say this.
- Written informed consent (CONSENT.md) before the session; participants can stop at any time and withdraw their
  data until analysis is complete.
- **Ethics:** many journals ask for ethics committee approval, or a documented exemption, for studies with human
  participants, including low-risk usability studies. Before recruiting, ask an institutional ethics committee
  (for example at a partner college or university) for approval or a written exemption, and record the reference
  here: `Ethics reference: ____________`. Do not start recruitment without it if the target journal requires it.

## 5. Data collected
Anonymous participant code (P01, P02, …). Group (A/B). Self-rated experience (none / some / regular) with R or
Python, the command line, and the type of analysis. Per task: success (1 = correct, 0.5 = correct with one hint,
0 = not completed or wrong), time on task in seconds, number of hints, observed problems. SUS answers. Free-text
comments.

**Not collected:** names on data sheets, e-mail addresses, screen or audio recordings (unless the participant
opts in separately on the consent form; recordings are deleted after notes are checked). Names on consent forms
are stored separately from data sheets.

## 6. Materials
- A laptop with a current browser, the Workbench at https://balajimadhvn.github.io/nayancode/ (or solagene.com),
  and the task files (section 8). Clear the browser's site data before each session.
- TASKS.md (participant sheet), SUS.md (questionnaire), results-template.csv (facilitator sheet).
- A stopwatch, or the timestamps in the Workbench's exported report (each analysis records its start time).

## 7. Procedure
1. Welcome, information sheet, consent (5 min).
2. Background questions (2 min).
3. Tasks 1–5 (TASKS.md), with think-aloud (30 min). Time starts when the participant finishes reading a task and
   stops when they state an answer. Maximum 8 minutes per task; then mark 0 and move on.
4. Hints: only after 2 minutes without progress, or when asked, and only from the standard hint list. Count them.
5. SUS questionnaire, filled in by the participant alone (3 min).
6. Short interview: what was hardest, what was missing, would you use it again, what would you use instead (5 min).

The facilitator does not demonstrate the tool, does not answer questions about where things are, and does not
comment on correctness during the tasks.

## 8. Task files
Run `node scripts/usability-materials.mjs` from the repository root. It writes `docs/usability/materials/`:
- `airway_counts.tsv` and `airway_samples.tsv`: public RNA-seq counts (Himes et al. 2014, airway package, LGPL).
- `pbmc3k/`: 10x Genomics PBMC3k matrix files (download with `bash benchmarks/fetch.sh` first).
Copy the folder to each test laptop.

## 9. Analysis
Enter the facilitator sheets into one CSV with the columns of results-template.csv, then run
`node scripts/usability-analyse.mjs path/to/results.csv`. It reports, per task and group: success rate with a Wilson
95 % interval, median and interquartile range of time on task, mean hints; and SUS scores (mean, SD, 95 % CI,
adjective rating per Bangor et al. 2009). Problems are listed with how many participants met them and a severity of
1 (cosmetic) to 4 (prevents completion). Report every participant, including incomplete sessions.

## 10. References
Brooke J (1996) SUS: a "quick and dirty" usability scale. In: Usability Evaluation in Industry. Taylor & Francis.
Bangor A, Kortum P, Miller J (2009) Determining what individual SUS scores mean. J Usability Stud 4:114–123.
Sauro J, Lewis JR (2016) Quantifying the User Experience, 2nd edn. Morgan Kaufmann.
Nielsen J (2000) Why you only need to test with 5 users. Nielsen Norman Group.
