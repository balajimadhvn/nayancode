# Contributing to the Nayancode Workbench

Thank you for helping. Bug reports, method requests and pull requests are welcome.

## Reporting a problem
Open an issue at https://github.com/balajimadhvn/nayancode/issues with: what you did, what you expected, what happened,
your browser and operating system, and (if you can share it) a small input file that reproduces the problem.
Please do not upload confidential or patient data.

## Asking for a method or feature
Open an issue describing the analysis, the publication that defines the method, and an example dataset.

## Contributing code
1. Fork the repository and create a branch.
2. `npm install`, then `npm run dev` to work locally.
3. Every analysis kernel needs a unit test against a known answer (a published example, a reference value or a
   simulation with a planted truth). Run `npm test`.
4. Run `npm run build` (licence audit, type-check and production build) and `npm run e2e`.
5. Open a pull request explaining the change and how it was validated.

Dependencies must carry a permissive licence (the build fails otherwise). Algorithms published under GPL software
must be re-implemented from the paper, not copied.

## Support
support@vivofold.in

## Code of conduct
Be respectful and constructive. Harassment or discrimination of any kind is not accepted. Report concerns to
support@vivofold.in; the maintainers will respond in confidence.
