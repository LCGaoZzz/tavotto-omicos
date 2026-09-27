# Tutorial project

This folder is the **offline tutorial project** that ships inside the OmicOS
package. OmicOS copies it into your user data directory the first time you
choose "Learn with an example"; that copy is yours to edit. Choosing
"Restart tutorial" restores this pristine version.

- `fig1_kinetics.py` → `Fig1_kinetics.pdf` (cell-state response, markers, two lines)
- `fig2_correlation.py` → `Fig2_correlation.pdf` (marker-score scatter + trend, one deliberately
  7 pt note that fails the 8 pt publication rule)
- `paper_style.py` shared style; only matplotlib's bundled STIX fonts (a Times-like
  serif accepted by the default publication profile, so the samples pass every
  check except the one deliberate 7 pt note)
- `tavotto_registry.json` stem ↔ script mapping
- `omicosfile/Tutorial.json` a ready-made canvas with both panels
- `tutorial_meta.json` stable metadata the app and its onboarding read

Nothing here needs network access or packages beyond numpy + matplotlib.
