---
name: spur-abbildungen
description: Rules for figures and tables in a spur paper, so they are restrained, readable and free of overlaps. Use when creating or changing an Abbildung, Grafik, Diagramm, TikZ picture, Tabelle, figure, table, chart, plot or caption, and in the agent spur:endpruefung.
---

# Figures and tables

These rules hold for every paper. Check each one by number after every change.

## Rules

Colour and distinction
1. Grey shades, or grey plus one single accent colour. No colourful fills.
2. Elements differ by line style (solid, dashed, dotted), hatching and labels, not by colour. The figure must still work printed in black and white.

Size and text
3. Text in a figure is no smaller than the footnote size and no larger than the body text (`\footnotesize` to `\normalsize`; in TikZ set `font=\small` on the picture).
4. Width at most `\textwidth`; a simple diagram (boxes and arrows) at most `0.7\textwidth`.
5. Height at most half a page, unless the figure is meant to fill a page.

Lines and arrows
6. No line or arrow crosses a label, and no arrow crosses another arrow.
7. Two parallel arrows with different meanings never run at the same height: offset them (`yshift`) or space them apart.
8. Every dashed or dotted line is explained, by a label on the line or a legend.

Tables
9. `booktabs` style: `\toprule`, `\midrule`, `\bottomrule`, no vertical lines, no `\hline`.
10. Matrix tables (feature × source) put "x" or `\checkmark` (from `amssymb`) in the cells, not sentences. A wide table uses `tabularx`, or goes landscape (`pdflscape`).

Captions and references
11. Every figure and table has a title (`\caption`), a source line ("Source: …", "Quelle: …", or "Eigene Darstellung" / "own illustration"), and is mentioned in the text (`\ref`, `\autoref` or `\cref`).
12. One figure, one message. If a figure answers two questions, split it.
13. The caption is understandable without the body text: it explains every abbreviation and symbol in the figure and names the units.
14. Figure, caption and text say the same, including positions such as "top left".
15. Figures and tables appear in the source in the order of their first mention.
16. Subfigures in one row are aligned at the top (`subcaption`, option `[t]`) and have the same height (`height=` in `\includegraphics`, or `\resizebox{!}{<height>}{…}`).

Rules 12 to 16 follow the principles catalogue of `andrehuang/academic-writing-agents` (MIT licence), in our own words.

## How to work

After every change to a figure or table:

1. `compile`, wait with `job_status`, read errors with `compile_log`.
2. Look at the page with `page_image`.
3. Tick the rules above as a list, one line each: number, ok or what fails. Do not tick a rule you did not look at.
4. Only then go on to the next figure or change.

To switch colours across the project (for example every `fill=blue!20` to `fill=black!10`), use `doc_edit` with `alle_vorkommen: true` instead of one call per place.

## Figures from sources

Take a figure from a source only with `source_figure_add` (needs an open licence) and put its `quellenangabe` into the caption. On `lizenz_fehlt`, redraw the figure yourself, for example in TikZ, and write "in Anlehnung an" (or "adapted from") with the full reference in the caption.

## Examples

Dashed arrow at the height of a labelled arrow. Not like this: both arrows on one line, the dashed one in colour and without explanation, and the label sits on top of it.

```latex
\begin{tikzpicture}[font=\small, node distance=3cm,
    box/.style={draw, minimum width=2.4cm, minimum height=1cm}]
  \node[box] (a) {Training};
  \node[box, right=of a] (b) {Performance};
  \draw[->] (a) -- node[above] {affects} (b);
  \draw[->, dashed, red] (a) -- (b);
\end{tikzpicture}
```

Like this: the arrows are offset, both are labelled, black only.

```latex
\begin{tikzpicture}[font=\small, node distance=3cm,
    box/.style={draw, minimum width=2.4cm, minimum height=1cm}]
  \node[box] (a) {Training};
  \node[box, right=of a] (b) {Performance};
  \draw[->] ([yshift=2.5mm]a.east) -- node[above] {affects} ([yshift=2.5mm]b.west);
  \draw[->, dashed] ([yshift=-2.5mm]a.east) -- node[below] {assumed} ([yshift=-2.5mm]b.west);
\end{tikzpicture}
```

Both need `\usetikzlibrary{positioning}`.

Matrix table, feature × source, with "x":

```latex
\begin{table}[t]
  \centering\small
  \caption{Features of the included studies}
  \label{tab:matrix}
  \begin{tabular}{lccc}
    \toprule
    Feature & Smith 2024 & Lee 2023 & Okafor 2022 \\
    \midrule
    Longitudinal design & x &   & x \\
    Validated scale     & x & x &   \\
    Sample over 500     &   & x & x \\
    \bottomrule
  \end{tabular}

  \smallskip
  \footnotesize Source: own illustration.
\end{table}
```

Subfigures of different size, aligned at the top with equal height:

```latex
\begin{figure}[t]
  \centering
  \begin{subfigure}[t]{0.45\textwidth}
    \centering
    \includegraphics[height=3cm]{abbildungen/a}
    \caption{Before}
  \end{subfigure}\hfill
  \begin{subfigure}[t]{0.45\textwidth}
    \centering
    \includegraphics[height=3cm]{abbildungen/b}
    \caption{After}
  \end{subfigure}
  \caption{Cohesion before and after the change; source: own illustration.}
\end{figure}
```
