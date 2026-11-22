---
status: open
id: qa-20261122-r4-10
title: Crowded worst band and inconsistent name cutting (band end-cut, list middle-cut, project rows sometimes lose their folder)
severity: cosmetic
area: view (band, list labels)
how to reproduce: gate gallery `wb4-worst-band-permission.png`; dev server with a project path whose last part is 75 characters
evidence: /tmp/qa-wb4-shots/gallery/wb4-worst-band-permission.png, /tmp/qa-wb4-shots/gallery/wb4-worst-band.png, /tmp/qa-wb4-shots/s5-03-gamma-long-name-band.png, /tmp/qa-wb4-shots/s5-04-list-4.png, /tmp/qa-wb4-shots/s4-06-new-session-long-name.png, /tmp/qa-wb4-shots/gallery/wb4-new-session.png
---

## What I saw

- Worst band, NEEDS PERMISSION: the hint triangle starts about 15 px (about 2.2 mm) after the last letter of
  PERMISSION, so it reads as `NEEDS PERMISSION▲9+`; the repo moves to the right of the first content row
  (`a-very-long-repos…`, bold white), where it looks like part of the request. Nothing overlaps or is cut off.
- Worst band, WORKING: the repo shows as `a-very-long-rep…`; 15 characters do not tell sessions apart.
- The same long repo is cut at the END in the band (`gamma-very-long-repository-name-fo…`) and in the MIDDLE in the
  list (`gamma-very-long-…he-infotainment-dashboard-project`), so the two do not look like the same name.
- New session rows: short paths show in full with the repeated prefix `/tmp/qa-wb4-run/repos/`, so the part that
  differs is at the right end. The long one drops its whole folder (`gamma-very-long-reposi…-name-for-the-…-project`),
  unlike the gallery rows, which keep `/home/user/...`.

## What I expected

A clear gap (or a separator) between the state word and the hint; one cutting rule for names in band and list; project
rows led by the last folder name (path after it, dimmer) so the distinguishing part comes first. All of it fits
1280x400 without overlap, which is good.
