.PHONY: all

JS_FILES =  \
	../3rdparty/to-function.js \
	../3rdparty/functional.js

JS_FILES += $(wildcard js/00-tokens.js)
JS_FILES += $(wildcard js/01-r-node-core.js)
JS_FILES += $(wildcard js/02-observable.js)
JS_FILES += $(wildcard js/03-r-api.js)
js_files += $(wildcard js/R/01-r-object.js)
js_files += $(wildcard js/R/02-r-parser-internal.js)
js_files += $(wildcard js/R/03-r-parser.js)
js_files += $(wildcard js/R/04-r-workspace.js)
JS_FILES += $(wildcard js/R/graphs/01-graph.js)
JS_FILES += $(wildcard js/R/graphs/02-hist.js)
JS_FILES += $(wildcard js/R/graphs/02-lines.js)
JS_FILES += $(wildcard js/R/graphs/02-plot.js)
JS_FILES += $(wildcard js/R/graphs/10-r-webvis-graph.js)
JS_FILES += $(wildcard js/R/graphs/10-server-graph.js)
JS_FILES += $(wildcard js/R/display/01-display.js)
JS_FILES += $(wildcard js/R/display/02-array.js)
JS_FILES += $(wildcard js/R/display/02-list.js)
JS_FILES += $(wildcard js/R/display/02-pager.js)
JS_FILES += $(wildcard js/R/display/02-table.js)
JS_FILES += $(wildcard js/R/display/02-try-error.js)
JS_FILES += $(wildcard js/R/commands/01-command-handler.js)
JS_FILES += $(wildcard js/R/commands/02-assignment.js)
JS_FILES += $(wildcard js/R/commands/02-help.js)
JS_FILES += $(wildcard js/R/commands/02-histogram.js)
JS_FILES += $(wildcard js/R/commands/02-lines.js)
JS_FILES += $(wildcard js/R/commands/02-plot.js)
JS_FILES += $(wildcard js/R/commands/02-print.js)
JS_FILES += $(wildcard js/R/commands/02-summary-general.js)
JS_FILES += $(wildcard js/R/commands/02-unsupported-commands.js)


# TODO use compiled version eventually.
JS_COMPILER = \
	java -jar ../3rdparty/google-compiler/compiler-20100201.jar \
	--charset UTF-8 \
	--warning_level=QUIET

all: clean r-node-shared.js
	mkdir -p ../deploy/htdocs/js/
	cd ../deploy/htdocs/js && cp -r ../../../shared/r-node-shared.js . && cd -

r-node-shared.js: $(JS_FILES) Makefile
	grep '	' -Hn $(JS_FILES) && echo "ERROR: tab" && exit 1 || true
	grep '' -Hn $(JS_FILES) && echo "ERROR: dos newline" && exit 1 || true
	grep ' $$' -Hn $(JS_FILES) && echo "ERROR: trailing space" && exit 1 || true
	rm -f $@
	echo "// $(shell git rev-parse HEAD)" >> $@
	cat $(JS_FILES) >> $@

clean:
	rm -f r-node-shared.js
	rm -f ../deploy/htdocs/js/r-node-shared.js

