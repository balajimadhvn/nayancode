"""Independent hand calculation of Tajima's D for a four-sequence alignment.

No third-party packages: the point is a reference that does not share code with
the TypeScript implementation.
"""
import itertools
import json
import math
import os

SEQ = ['AAAA', 'AAAT', 'AATT', 'ATTT']


def pairwise_differences(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


def main():
    n = len(SEQ)
    length = len(SEQ[0])
    assert all(len(s) == length for s in SEQ)

    segregating = 0
    per_site_diff = []
    for j in range(length):
        col = [s[j] for s in SEQ]
        if len(set(col)) > 1:
            segregating += 1
        pairs = [pairwise_differences(a, b) for a, b in itertools.combinations(col, 2)]
        per_site_diff.append(sum(pairs) / len(pairs))

    pi = sum(per_site_diff)
    a1 = sum(1.0 / i for i in range(1, n))
    a2 = sum(1.0 / (i * i) for i in range(1, n))
    theta_w = segregating / a1

    b1 = (n + 1) / (3 * (n - 1))
    b2 = (2 * (n * n + n + 3)) / (9 * n * (n - 1))
    c1 = b1 - 1 / a1
    c2 = b2 - (n + 2) / (a1 * n) + a2 / (a1 * a1)
    e1 = c1 / a1
    e2 = c2 / (a1 * a1 + a2)

    denominator = math.sqrt(e1 * segregating + e2 * segregating * (segregating - 1))
    d = (pi - theta_w) / denominator

    out = {
        'alignment': SEQ,
        'n': n,
        'sites': length,
        'S': segregating,
        'pi': pi,
        'thetaW': theta_w,
        'tajimasD': d,
        'a1': a1,
        'a2': a2,
        'e1': e1,
        'e2': e2,
    }
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'reference.json'), 'w') as fh:
        json.dump(out, fh, indent=2)
        fh.write('\n')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
