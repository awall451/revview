---
id: qa-20261122-r5-06
title: A long path token in a command breaks mid-word ("director / y-name")
severity: cosmetic
area: view command wrapping
how to reproduce: /tmp/qa5-scripts/r5.mjs, case longcmd (Bash `npx playwright test ... --output=/tmp/qa5-run/test-results-with-a-very-long-directory-name ...`)
evidence: /tmp/qa5-shots/r5-longcmd.png
---

Flags break at spaces as the r3-09 fix intends (`--reporter=line` stays whole). A token longer than the line has to
break somewhere; with the word joiners after hyphens it breaks between letters ("...very-long-director" / "y-name")
instead of after a hyphen or slash. Breaking after `/` or `-` inside an over-long token would read better.
