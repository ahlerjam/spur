// Dokumente, die der Smoke-Test im Image kompiliert. Ohne Abhängigkeiten, damit
// tools/tests/tex-pakete.test.mjs sie gegen die Paketliste des Images prüfen kann.
const APA_MAIN = String.raw`\documentclass{article}
\usepackage[style=apa,backend=biber]{biblatex}
\usepackage{csquotes}
\addbibresource{references.bib}
\begin{document}
\enquote{Smoke} \autocite{smoke}
\printbibliography
\end{document}`

const APA_BIB = `@article{smoke,
  author = {Smith, Alice},
  title = {Smoke},
  journal = {Journal},
  year = {2024}
}`

// Deutsch, Chemie, Einheiten und das Beamer-Theme metropolis, wie in der ersten echten Session.
const FOLIEN_MAIN = String.raw`\documentclass{beamer}
\usetheme{metropolis}
\usepackage[ngerman]{babel}
\usepackage[version=4]{mhchem}
\usepackage{chemformula}
\usepackage{siunitx}
\begin{document}
\begin{frame}{Ergebnisse}
Silbentrennung: Lebensmittelverschwendung. Wasser ist \ce{H2O}, Kohlendioxid \ch{CO2}.
Das Volumen betrug \qty{0.89}{\liter}.
\end{frame}
\end{document}`

export const DOKUMENTE = [
  { name: 'APA', dateien: { 'main.tex': APA_MAIN, 'references.bib': APA_BIB } },
  { name: 'Folien', dateien: { 'main.tex': FOLIEN_MAIN } },
]
