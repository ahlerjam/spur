import { Trans } from 'react-i18next'
import {
  packageSuggestionsForCommands,
  packageSuggestionsForEnvironments,
} from './HumanReadableLogsPackageSuggestions'
import getMeta from '@/utils/meta'

// spur: Die Hinweise stehen als Übersetzungsschlüssel (log_hint_*) in den Sprachdateien, nicht mehr im Quelltext.
function WikiLink({
  url,
  children,
}: {
  url: string
  children?: React.ReactNode
}) {
  if (getMeta('ol-wikiEnabled')) {
    return (
      <a href={url} target="_blank" rel="noopener">
        {children}
      </a>
    )
  } else {
    return <>{children}</>
  }
}

function LernMehr({ url }: { url: string }) {
  return (
    <div className="log-entry-content-link">
      <Trans
        i18nKey="log_hint_learn_more"
        components={{
          // eslint-disable-next-line jsx-a11y/anchor-has-content
          a: <a href={url} target="_blank" rel="noopener" />,
        }}
      />
    </div>
  )
}

type LogHint = {
  extraInfoURL?: string | null
  formattedContent: (details?: string[]) => React.ReactNode
}

const hints: { [ruleId: string]: LogHint } = {
  hint_misplaced_alignment_tab_character: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Misplaced_alignment_tab_character_%26',
    formattedContent: () => (
      <Trans i18nKey="log_hint_misplaced_alignment_tab_character" />
    ),
  },
  hint_extra_alignment_tab_has_been_changed: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Extra_alignment_tab_has_been_changed_to_%5Ccr',
    formattedContent: () => (
      <Trans i18nKey="log_hint_extra_alignment_tab_has_been_changed" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Tables" /> }} />
    ),
  },
  hint_display_math_should_end_with: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Display_math_should_end_with_$$',
    formattedContent: () => (
      <Trans i18nKey="log_hint_display_math_should_end_with" />
    ),
  },
  hint_missing_inserted: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Missing_$_inserted',
    formattedContent: () => (
      <Trans i18nKey="log_hint_missing_inserted" components={{ p: <p />, code: <code /> }} />
    ),
  },
  hint_reference_undefined: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/There_were_undefined_references',
    formattedContent: () => (
      <Trans i18nKey="log_hint_reference_undefined" />
    ),
  },
  hint_there_were_undefined_references: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/There_were_undefined_references',
    formattedContent: () => (
      <Trans i18nKey="log_hint_there_were_undefined_references" />
    ),
  },
  hint_citation_on_page_undefined_on_input_line: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Citation_XXX_on_page_XXX_undefined_on_input_line_XXX',
    formattedContent: () => (
      <Trans i18nKey="log_hint_citation_on_page_undefined_on_input_line" />
    ),
  },
  hint_label_multiply_defined_labels: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/There_were_multiply-defined_labels',
    formattedContent: () => (
      <Trans i18nKey="log_hint_label_multiply_defined_labels" />
    ),
  },
  hint_float_specifier_changed: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/%60!h%27_float_specifier_changed_to_%60!ht%27',
    formattedContent: () => (
      <Trans i18nKey="log_hint_float_specifier_changed" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Positioning_of_Figures" /> }} />
    ),
  },
  hint_no_positions_in_optional_float_specifier: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/No_positions_in_optional_float_specifier',
    formattedContent: () => (
      <Trans i18nKey="log_hint_no_positions_in_optional_float_specifier" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Positioning_of_Figures" /> }} />
    ),
  },
  hint_undefined_control_sequence: {
    formattedContent: details => {
      if (details?.length) {
        const befehl = details[0]
        const vorschlag = packageSuggestionsForCommands.get(befehl)
        if (vorschlag) {
          return (
            <p>
              <Trans
                i18nKey="log_hint_package_command"
                values={{ befehl, vorschlag: vorschlag.command }}
                components={{ code: <code />, w1: <WikiLink url="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes#The_preamble_of_a_document" />, w2: <WikiLink url="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes#Finding_and_using_LaTeX_packages" /> }}
              />
            </p>
          )
        }
      }
      return (
        <>
          <Trans
            i18nKey="log_hint_undefined_control_sequence"
            components={{ code: <code /> }}
          />
          <LernMehr url="https://www.overleaf.com/learn/Errors/Undefined_control_sequence" />
        </>
      )
    },
  },
  hint_undefined_environment: {
    formattedContent: details => {
      if (details?.length) {
        const umgebung = details[0]
        const vorschlag = packageSuggestionsForEnvironments.get(umgebung)
        if (vorschlag) {
          return (
            <p>
              <Trans
                i18nKey="log_hint_package_environment"
                values={{ umgebung, vorschlag: vorschlag.command }}
                components={{ code: <code />, w1: <WikiLink url="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes#The_preamble_of_a_document" />, w2: <WikiLink url="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes#Finding_and_using_LaTeX_packages" /> }}
              />
            </p>
          )
        }
      }
      return (
        <>
          <Trans i18nKey="log_hint_undefined_environment" />
          <LernMehr url="https://www.overleaf.com/learn/Errors%2FLaTeX%20Error%3A%20Environment%20XXX%20undefined" />
        </>
      )
    },
  },
  hint_file_not_found: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/File_XXX_not_found_on_input_line_XXX',
    formattedContent: () => (
      <Trans i18nKey="log_hint_file_not_found" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/how-to/Including_images_on_Overleaf" />, w2: <WikiLink url="https://www.overleaf.com/learn/Errors/File_XXX_not_found_on_input_line_XXX." /> }} />
    ),
  },
  hint_unknown_graphics_extension: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_Unknown_graphics_extension:_.XXX',
    formattedContent: () => (
      <Trans i18nKey="log_hint_unknown_graphics_extension" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Errors/LaTeX_Error:_Unknown_graphics_extension:_.gif." /> }} />
    ),
  },
  hint_unknown_float_option_h: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_Unknown_float_option_%60H%27',
    formattedContent: () => (
      <Trans i18nKey="log_hint_unknown_float_option_h" />
    ),
  },
  hint_unknown_float_option_q: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_Unknown_float_option_%60q%27',
    formattedContent: () => (
      <Trans i18nKey="log_hint_unknown_float_option_q" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Positioning_of_Figures" /> }} />
    ),
  },
  hint_math_allowed_only_in_math_mode: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_%5Cmathrm_allowed_only_in_math_mode',
    formattedContent: () => (
      <Trans i18nKey="log_hint_math_allowed_only_in_math_mode" />
    ),
  },
  hint_mismatched_environment: {
    formattedContent: () => (
      <Trans i18nKey="log_hint_mismatched_environment" />
    ),
  },
  hint_mismatched_brackets: {
    formattedContent: () => (
      <Trans i18nKey="log_hint_mismatched_brackets" />
    ),
  },
  hint_can_be_used_only_in_preamble: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_Can_be_used_only_in_preamble',
    formattedContent: () => (
      <Trans i18nKey="log_hint_can_be_used_only_in_preamble" />
    ),
  },
  hint_missing_right_inserted: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Missing_%5Cright_insertede',
    formattedContent: () => (
      <Trans i18nKey="log_hint_missing_right_inserted" components={{ w1: <WikiLink url="https://www.overleaf.com/learn/Errors/Missing_%5Cright_inserted" /> }} />
    ),
  },
  hint_double_superscript: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Double_superscript',
    formattedContent: () => (
      <Trans i18nKey="log_hint_double_superscript" />
    ),
  },
  hint_double_subscript: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Double_subscript',
    formattedContent: () => (
      <Trans i18nKey="log_hint_double_subscript" />
    ),
  },
  hint_no_author_given: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/No_%5Cauthor_given',
    formattedContent: () => (
      <Trans i18nKey="log_hint_no_author_given" />
    ),
  },
  hint_somethings_wrong_perhaps_a_missing_item: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_Something%27s_wrong--perhaps_a_missing_%5Citem',
    formattedContent: () => (
      <Trans i18nKey="log_hint_somethings_wrong_perhaps_a_missing_item" />
    ),
  },
  hint_misplaced_noalign: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Misplaced_%5Cnoalign',
    formattedContent: () => (
      <Trans i18nKey="log_hint_misplaced_noalign" />
    ),
  },
  hint_no_line_here_to_end: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_There%27s_no_line_here_to_end',
    formattedContent: () => (
      <Trans i18nKey="log_hint_no_line_here_to_end" />
    ),
  },
  hint_verb_ended_by_end_of_line: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/LaTeX_Error:_%5Cverb_ended_by_end_of_line',
    formattedContent: () => (
      <Trans i18nKey="log_hint_verb_ended_by_end_of_line" />
    ),
  },
  hint_illegal_unit_of_measure_pt_inserted: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors%2FIllegal%20unit%20of%20measure%20(pt%20inserted)',
    formattedContent: () => (
      <Trans i18nKey="log_hint_illegal_unit_of_measure_pt_inserted" />
    ),
  },
  hint_extra_right: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors/Extra_%5Cright',
    formattedContent: () => (
      <Trans i18nKey="log_hint_extra_right" />
    ),
  },
  hint_missing_begin_document_: {
    extraInfoURL:
      'https://www.overleaf.com/learn/Errors%2FLaTeX%20Error%3A%20Missing%20%5Cbegin%20document',
    formattedContent: () => (
      <Trans i18nKey="log_hint_missing_begin_document_" />
    ),
  },
  hint_mismatched_environment2: {
    formattedContent: () => (
      <Trans i18nKey="log_hint_mismatched_environment2" />
    ),
  },
  hint_mismatched_environment3: {
    formattedContent: () => (
      <Trans i18nKey="log_hint_mismatched_environment3" />
    ),
  },
  hint_mismatched_environment4: {
    formattedContent: () => (
      <Trans i18nKey="log_hint_mismatched_environment4" />
    ),
  },
}

export const ruleIds = Object.keys(hints)

if (!getMeta('ol-wikiEnabled')) {
  Object.keys(hints).forEach(ruleId => {
    hints[ruleId].extraInfoURL = null
  })
}

export default hints
