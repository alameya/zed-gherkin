; Comments
(comment) @comment

; Language directive: `# language: ru`
(language) @keyword.directive
(language_name) @constant
(invalid_language_name) @error

; Section keywords
[
  (feature_kw)
  (rule_kw)
  (background_kw)
  (scenario_kw)
  (scenario_outline_kw)
  (examples_kw)
] @keyword

; Step keywords
[
  (given_kw)
  (when_kw)
  (then_kw)
  (and_kw)
  (but_kw)
] @keyword.function

; Titles of features, rules, scenarios and example blocks
(feature_line (context) @type)
(rule_line (context) @type)
(scenario_line (context) @type)
(scenario_outline_line (context) @type)
(background_line (context) @type)
(examples_line (context) @type)

; Tags: @wip
(tag) @tag

; Step parameters: <placeholder>
(step_param) @variable.parameter

; Doc strings (""" ... """ / ``` ... ```)
(doc_string_content) @string
(doc_string (media_type) @label)

; Data tables
(table_head_row (table_col (table_cell) @variable.parameter))
(table_row (table_col (table_cell) @string.special))

; Table delimiters
["|"] @punctuation.delimiter
