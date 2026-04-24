_js_ref() {
  local -a completions
  completions=(${(f)"$(js-ref --list-keys 2>/dev/null)"})
  _describe 'js-ref entries' completions
}
compdef _js_ref js-ref
