define([
    'jquery',
    'bluebird',
    'kb_common/html',
    '../validation',
    'common/events',
    'common/runtime',
    'common/ui',
    'common/props',
    'base/js/namespace',
    '../subdataMethods/manager',
    'bootstrap',
], ($, Promise, html, Validation, Events, Runtime, UI, Props, Jupyter, SubdataMethods) => {
    'use strict';

    /*
     * spec
     *   textsubdata_options
     *     allow_custom: 0/1
     *     multiselection: 0/1
     *     placholder: text
     *     show_src_obj: 0/1
     *     subdata_selection:
     *       parameter_id: string
     *       path_to_subdata: array<string>
     *       selection_id: string
     *       subdata_included: array<string>
     *
     */

    // Constants
    const t = html.tag,
        div = t('div'),
        p = t('p'),
        span = t('span'),
        input = t('input'),
        option = t('option'),
        button = t('button');

    function factory(config) {
        const spec = config.parameterSpec,
            appSpec = config.appSpec,
            runtime = Runtime.make(),
            workspaceId = runtime.getEnv('workspaceId'),
            busConnection = runtime.bus().connect(),
            channel = busConnection.channel(config.channelName),
            model = Props.make({
                data: {
                    referenceObjectName: null,
                    availableValues: [],
                    selectedItems: [],
                    value: null,
                    showFrom: 0,
                    showTo: 5,
                },
                onUpdate: function () {
                    renderStats();
                    renderToolbar();
                    renderAvailableItems();
                    renderSelectedItems();
                },
            }),
            subdataMethods = SubdataMethods.make();

        let parent, container, ui;

        function buildOptions() {
            const availableValues = model.getItem('availableValues'),
                value = model.getItem('value') || [],
                selectOptions = [option({ value: '' }, '')];
            if (!availableValues) {
                return selectOptions;
            }
            return selectOptions.concat(
                availableValues.map((availableValue) => {
                    const optionLabel = availableValue.id,
                        optionValue = availableValue.id;
                    let selected = false;
                    // TODO: pull the value out of the object
                    if (value.indexOf(availableValue.id) >= 0) {
                        selected = true;
                    }
                    return option(
                        {
                            value: optionValue,
                            selected: selected,
                        },
                        optionLabel
                    );
                })
            );
        }

        function buildCount() {
            const availableValues = model.getItem('availableValues') || [],
                value = model.getItem('value') || [];

            return String(value.length) + ' / ' + String(availableValues.length) + ' items';
        }

        function filterItems(items, filter) {
            if (!filter) {
                return items;
            }
            const re = new RegExp(filter);
            return items.filter((item) => {
                if (item.text && item.text.match(re, 'i')) {
                    return true;
                }
                return false;
            });
        }

        function doFilterItems() {
            const items = model.getItem('availableValues', []),
                filteredItems = filterItems(items, model.getItem('filter'));

            // for now we just reset the from/to range to the beginning.
            model.setItem('filteredAvailableItems', filteredItems);

            doFirstPage();
        }

        function didChange() {
            validate().then((result) => {
                if (result.isValid || result.diagnosis === 'required-missing') {
                    model.setItem('value', result.value);
                    updateInputControl('value');
                    channel.emit('changed', {
                        newValue: result.value,
                    });
                }
                channel.emit('validation', {
                    errorMessage: result.errorMessage,
                    diagnosis: result.diagnosis,
                });
            });
        }

        function doAddItem(itemId) {
            const selectedItems = model.getItem('selectedItems', []);
            selectedItems.push(itemId);
            model.setItem('selectedItems', selectedItems);
            didChange();
        }

        function doRemoveSelectedItem(indexOfitemToRemove) {
            const selectedItems = model.getItem('selectedItems', []),
                prevAllowSelection = spec.ui.multiSelection || selectedItems.length === 0;
            selectedItems.splice(indexOfitemToRemove, 1);

            const newAllowSelection = spec.ui.multiSelection || selectedItems.length === 0;
            if (newAllowSelection && !prevAllowSelection) {
                // update text areas to have md-col-7 (from md-col-10)
                $(ui.getElement('input-container'))
                    .find('.row > .col-md-10')
                    .switchClass('col-md-10', 'col-md-7');
                $(ui.getElement('input-container')).find('.col-md-3.hidden').removeClass('hidden');

                // update button areas to remove hidden class
            }
            model.setItem('selectedItems', selectedItems);
            didChange();
        }

        function doRemoveSelectedAvailableItem(idToRemove) {
            const selectedItems = model.getItem('selectedItems', []);

            model.setItem(
                'selectedItems',
                selectedItems.filter((id) => {
                    if (idToRemove === id) {
                        return false;
                    }
                    return true;
                })
            );
            didChange();
        }

        function renderAvailableItems() {
            const selected = model.getItem('selectedItems', []),
                allowSelection = spec.ui.multiSelection || selected.length === 0,
                items = model.getItem('filteredAvailableItems', []),
                from = model.getItem('showFrom'),
                to = model.getItem('showTo'),
                itemsToShow = items.slice(from, to),
                events = Events.make({ node: container });
            let content;

            if (itemsToShow.length === 0) {
                content = div({ style: { textAlign: 'center' } }, 'no available values');
            } else {
                content = itemsToShow
                    .map((item, index) => {
                        const isSelected = selected.some((id) => {
                                return item.id === id;
                            }),
                            disabled = isSelected;
                        return div({ class: 'row', style: { border: '1px solid #CCC' } }, [
                            div(
                                {
                                    class: 'col-md-2',
                                    style: {
                                        verticalAlign: 'middle',
                                        borderRadius: '3px',
                                        padding: '2px',
                                        backgroundColor: '#EEE',
                                        color: '#444',
                                        textAlign: 'right',
                                        paddingRight: '6px',
                                        fontFamily: 'monospace',
                                    },
                                },
                                String(from + index + 1)
                            ),
                            div(
                                {
                                    class: 'col-md-8',
                                    style: {
                                        padding: '2px',
                                    },
                                },
                                item.text
                            ),
                            div(
                                {
                                    class: 'col-md-2',
                                    style: {
                                        padding: '2px',
                                        textAlign: 'right',
                                        verticalAlign: 'top',
                                    },
                                },
                                [
                                    (function () {
                                        if (disabled) {
                                            return span(
                                                {
                                                    class: 'kb-btn-icon',
                                                    type: 'button',
                                                    dataToggle: 'tooltip',
                                                    title: 'Remove from selected',
                                                    id: events.addEvent({
                                                        type: 'click',
                                                        handler: function () {
                                                            doRemoveSelectedAvailableItem(item.id);
                                                        },
                                                    }),
                                                },
                                                [
                                                    span({
                                                        class: 'fa fa-2x fa-minus-circle text-danger',
                                                    }),
                                                ]
                                            );
                                        }
                                        if (allowSelection) {
                                            return span(
                                                {
                                                    class: 'kb-btn-icon',
                                                    type: 'button',
                                                    dataToggle: 'tooltip',
                                                    title: 'Add to selected',
                                                    dataItemId: item.id,
                                                    id: events.addEvent({
                                                        type: 'click',
                                                        handler: function () {
                                                            doAddItem(item.id);
                                                        },
                                                    }),
                                                },
                                                [
                                                    span({
                                                        class: 'fa fa-2x fa-plus-circle text-success',
                                                    }),
                                                ]
                                            );
                                        }
                                        return span(
                                            {
                                                class: 'kb-btn-icon',
                                                type: 'button',
                                                dataToggle: 'tooltip',
                                                title: "Can't add - remove one first",
                                                dataItemId: item.id,
                                            },
                                            span({
                                                class: 'fa fa-2x fa-ban text-silver',
                                            })
                                        );
                                    })(),
                                ]
                            ),
                        ]);
                    })
                    .join('\n');
            }

            ui.setContent('available-items', content);
            events.attachEvents();
            ui.enableTooltips('available-items');
        }

        function renderSelectedItems() {
            const selectedItems = model.getItem('selectedItems', []),
                valuesMap = model.getItem('availableValuesMap', {}),
                events = Events.make({ node: container });
            let content;

            if (selectedItems.length === 0) {
                content = div({ style: { textAlign: 'center' } }, 'no selected values');
            } else {
                content = selectedItems
                    .map((itemId, index) => {
                        let item = valuesMap[itemId];
                        if (item === undefined || item === null) {
                            item = {
                                text: itemId,
                            };
                        }

                        return div(
                            {
                                class: 'row',
                                style: {
                                    border: '1px solid #CCC',
                                    borderCollapse: 'collapse',
                                    boxSizing: 'border-box',
                                },
                            },
                            [
                                div(
                                    {
                                        class: 'col-md-2',
                                        style: {
                                            verticalAlign: 'middle',
                                            borderRadius: '3px',
                                            padding: '2px',
                                            backgroundColor: '#EEE',
                                            color: '#444',
                                            textAlign: 'right',
                                            paddingRight: '6px',
                                            fontFamily: 'monospace',
                                        },
                                    },
                                    String(index + 1)
                                ),
                                div(
                                    {
                                        class: 'col-md-8',
                                        style: {
                                            padding: '2px',
                                        },
                                    },
                                    item.text
                                ),
                                div(
                                    {
                                        class: 'col-md-2',
                                        style: {
                                            padding: '2px',
                                            textAlign: 'right',
                                            verticalAlign: 'top',
                                        },
                                    },
                                    [
                                        span(
                                            {
                                                class: 'kb-btn-icon',
                                                type: 'button',
                                                dataToggle: 'tooltip',
                                                title: 'Remove from selected',
                                                id: events.addEvent({
                                                    type: 'click',
                                                    handler: function () {
                                                        doRemoveSelectedItem(index);
                                                    },
                                                }),
                                            },
                                            span({
                                                class: 'fa fa-2x fa-minus-circle text-danger',
                                            })
                                        ),
                                    ]
                                ),
                            ]
                        );
                    })
                    .join('\n');
            }
            ui.setContent('selected-items', content);
            events.attachEvents();
            ui.enableTooltips('selected-items');
        }

        function renderSearchBox() {
            const events = Events.make({ node: container });
            const content = input({
                class: 'form-contol',
                placeholder: 'search',
                value: model.getItem('filter') || '',
                id: events.addEvents({
                    events: [
                        {
                            type: 'keyup',
                            handler: function (e) {
                                doSearchKeyUp(e);
                            },
                        },
                        {
                            type: 'focus',
                            handler: function () {
                                Jupyter.narrative.disableKeyboardManager();
                            },
                        },
                        {
                            type: 'click',
                            handler: function () {
                                Jupyter.narrative.disableKeyboardManager();
                            },
                        },
                    ],
                }),
            });

            ui.setContent('search-box', content);
            events.attachEvents();
        }

        function renderStats() {
            const availableItems = model.getItem('availableValues', []),
                filteredItems = model.getItem('filteredAvailableItems', []);
            let content;

            if (availableItems.length === 0) {
                content = span({ style: { fontStyle: 'italic' } }, [' - no available items']);
            } else {
                content = span({ style: { fontStyle: 'italic' } }, [
                    ' - filtering ',
                    span([String(filteredItems.length), ' of ', String(availableItems.length)]),
                ]);
            }

            ui.setContent('stats', content);
        }

        function renderToolbar() {
            const items = model.getItem('filteredAvailableItems', []),
                events = Events.make({ node: container });
            let content;

            if (items.length === 0) {
                content = '';
            } else {
                content = div([
                    button(
                        {
                            type: 'button',
                            class: 'btn btn-default',
                            id: events.addEvent({
                                type: 'click',
                                handler: function () {
                                    doFirstPage();
                                },
                            }),
                        },
                        ui.buildIcon({ name: 'step-forward', rotate: 270 })
                    ),
                    button(
                        {
                            class: 'btn btn-default',
                            type: 'button',
                            id: events.addEvent({
                                type: 'click',
                                handler: function () {
                                    doPreviousPage();
                                },
                            }),
                        },
                        ui.buildIcon({ name: 'caret-up' })
                    ),
                    button(
                        {
                            class: 'btn btn-default',
                            type: 'button',
                            id: events.addEvent({
                                type: 'click',
                                handler: function () {
                                    doNextPage();
                                },
                            }),
                        },
                        ui.buildIcon({ name: 'caret-down' })
                    ),
                    button(
                        {
                            type: 'button',
                            class: 'btn btn-default',
                            id: events.addEvent({
                                type: 'click',
                                handler: function () {
                                    doLastPage();
                                },
                            }),
                        },
                        ui.buildIcon({ name: 'step-forward', rotate: 90 })
                    ),
                ]);
            }

            ui.setContent('toolbar', content);
            events.attachEvents();
        }

        function setPageStart(newFrom) {
            const from = model.getItem('showFrom'),
                to = model.getItem('to'),
                total = model.getItem('filteredAvailableItems', []).length,
                pageSize = 5;
            let newTo;

            if (newFrom <= 0) {
                newFrom = 0;
            } else if (newFrom >= total) {
                newFrom = total - pageSize;
                if (newFrom < 0) {
                    newFrom = 0;
                }
            }

            if (newFrom !== from) {
                model.setItem('showFrom', newFrom);
            }

            newTo = newFrom + pageSize;
            if (newTo >= total) {
                newTo = total;
            }
            if (newTo !== to) {
                model.setItem('showTo', newTo);
            }
        }

        function movePageStart(diff) {
            setPageStart(model.getItem('showFrom') + diff);
        }

        function doPreviousPage() {
            movePageStart(-5);
        }

        function doNextPage() {
            movePageStart(5);
        }

        function doFirstPage() {
            setPageStart(0);
        }

        function doLastPage() {
            setPageStart(model.getItem('filteredAvailableItems').length);
        }

        function doSearchKeyUp(e) {
            if (e.target.value.length > 2) {
                model.setItem('filter', e.target.value);
                doFilterItems();
            } else {
                if (model.getItem('filter')) {
                    model.setItem('filter', null);
                    doFilterItems();
                }
            }
        }

        function makeInputControl() {
            // There is an input control, and a dropdown,
            // TODO select2 after we get a handle on this...
            const availableValues = model.getItem('availableValues');

            if (!availableValues) {
                return p(
                    {
                        class: 'form-control-static',
                        style: {
                            fontStyle: 'italic',
                            whiteSpace: 'normal',
                            padding: '3px',
                            border: '1px solid silver',
                        },
                    },
                    'Items will be available after selecting a value for ' +
                        spec.data.constraints.subdataSelection.parameter_id
                );
            }

            return div([
                ui.buildCollapsiblePanel({
                    title: span(['Available Items', span({ dataElement: 'stats' })]),
                    classes: ['kb-panel-light'],
                    body: div(
                        { dataElement: 'available-items-area', style: { marginTop: '10px' } },
                        [
                            div({ class: 'row' }, [
                                div(
                                    {
                                        class: 'col-md-6',
                                    },
                                    [span({ dataElement: 'search-box' })]
                                ),
                                div({
                                    class: 'col-md-6',
                                    style: { textAlign: 'right' },
                                    dataElement: 'toolbar',
                                }),
                            ]),
                            div({ class: 'row', style: { marginTop: '4px' } }, [
                                div(
                                    { class: 'col-md-12' },
                                    div({
                                        style: {
                                            border: '1px solid silver',
                                        },
                                        dataElement: 'available-items',
                                    })
                                ),
                            ]),
                        ]
                    ),
                }),
                ui.buildPanel({
                    title: 'Selected Items',
                    classes: ['kb-panel-light'],
                    body: div({
                        style: {
                            border: '1px solid silver',
                        },
                        dataElement: 'selected-items',
                    }),
                }),
            ]);
        }

        /*
         * Given an existing input control, and new model state, update the
         * control to suite the new data.
         * Cases:
         *
         * - change in source data - fetch new data, populate available values,
         *   reset selected values, remove existing options, add new options.
         *
         * - change in selected items - remove all selections, add new selections
         *
         */
        function updateInputControl(changedProperty) {
            const count = buildCount();
            if (changedProperty === 'value') {
                // just change the selections.
                ui.setContent('input-control.count', count);
            } else if (changedProperty === 'availableValues') {
                // rebuild the options
                // re-apply the selections from the value
                ui.setContent('input-control.input', buildOptions());
                ui.setContent('input-control.count', count);
            }
        }

        /*
         * If the parameter is optional, and is empty, return null.
         * If it allows multiple values, wrap single results in an array
         * There is a weird twist where if it ...
         * well, hmm, the only consumer of this, isValid, expects the values
         * to mirror the input rows, so we shouldn't really filter out any
         * values.
         */
        function getInputValue() {
            return model.getItem('selectedItems');
        }

        function resetModelValue() {
            model.reset();
            model.setItem('value', spec.defaultValue);
        }

        function validate() {
            return Promise.try(() => {
                const rawValue = getInputValue(),
                    validationOptions = {
                        required: spec.data.constraints.required,
                    };

                return Validation.validateStringSet(rawValue, validationOptions);
            });
        }

        const subdataInfo = subdataMethods.getSubdataInfo(appSpec, spec);

        function fetchData() {
            const referenceObjectName = model.getItem('referenceObjectName'),
                referenceObjectRef = workspaceId + '/' + referenceObjectName,
                params = model.getItem('required-params');

            if (!referenceObjectName) {
                return;
            }

            return subdataMethods.customFetchData({
                referenceObjectRef: referenceObjectRef,
                params: params,
                getRef: subdataInfo.getRef,
                included: subdataInfo.included,
                extractItems: subdataInfo.extractItems,
            });
        }

        function syncAvailableValues() {
            return Promise.try(() => {
                return fetchData();
            }).then((data) => {
                if (!data) {
                    return ' no data? ';
                }

                // If default values have been provided, prepend them to the data.

                // We use the raw default values here since we are not really using
                // it as the default value, but as a set of additional items
                // to select.
                const defaultValues = spec.defaultValue;
                if (defaultValues && defaultValues instanceof Array && defaultValues.length > 0) {
                    defaultValues.forEach((itemId) => {
                        if (itemId && itemId.trim().length > 0) {
                            data.unshift({
                                id: itemId,
                                text: itemId,
                            });
                        }
                    });
                }

                // The data represents the total available subdata, with all
                // necessary fields for display. We build from that three
                // additional structures
                // - a map of id to object
                // - a set of available ids
                // - a set of selected ids
                // - a set of filtered ids
                model.setItem('availableValues', data);

                // TODO: generate all of this in the fetchData -- it will be a bit faster.
                const map = {};
                data.forEach((datum) => {
                    map[datum.id] = datum;
                });

                model.setItem('availableValuesMap', map);

                doFilterItems();
            });
        }

        function autoValidate() {
            return validate().then((result) => {
                channel.emit('validation', {
                    errorMessage: result.errorMessage,
                    diagnosis: result.diagnosis,
                });
            });
        }

        /*
         * Creates the markup
         * Places it into the ui node
         * Hooks up event listeners
         */
        function render() {
            return Promise.try(() => {
                // check to see if we have to render inputControl.
                const events = Events.make({ node: container }),
                    inputControl = makeInputControl(),
                    content = div(
                        {
                            class: 'input-group',
                            style: {
                                width: '100%',
                            },
                        },
                        inputControl
                    );

                ui.setContent('input-container', content);
                renderSearchBox();
                renderStats();
                renderToolbar();
                renderAvailableItems();
                renderSelectedItems();

                events.attachEvents();
            })
                .then(() => {
                    return autoValidate();
                })
                .catch((err) => {
                    console.error('ERROR in render', err);
                });
        }

        /*
         * In the layout we set up an environment in which one or more parameter
         * rows may be inserted.
         * For the objectInput, there is only ever one control.
         */
        function layout(events) {
            const content = div(
                {
                    dataElement: 'main-panel',
                },
                [
                    div({
                        dataElement: 'input-container',
                    }),
                ]
            );
            return {
                content: content,
                events: events,
            };
        }

        function updateParam(paramId, value) {
            let newValue;
            if (value === '') {
                newValue = null;
            } else {
                newValue = value;
            }

            if (newValue === model.getItem(['required-params', paramId])) {
                return;
            }

            model.setItem('value', []);
            model.setItem(['required-params', paramId], newValue);

            // If any of the required parameters are missing, we need to reset the
            // primary value.
            // TODO: we need to get this via the message bus!!!
            if (
                subdataInfo.params.dependencies.some((_paramId) => {
                    return model.getItem(['required-params', _paramId], null) === null;
                })
            ) {
                resetModelValue();
            }

            // If we have a change in the primary reference object, we need to
            // resync the values derived from it (available values).
            if (paramId === subdataInfo.params.referenceObject) {
                model.setItem('referenceObjectName', newValue);
                return syncAvailableValues();
            }
        }

        function registerEvents() {
            /*
             * Issued when thre is a need to have all params reset to their
             * default value.
             */
            channel.on('reset-to-defaults', () => {
                resetModelValue();
                // TODO: this should really be set when the linked field is reset...
                model.setItem('availableValues', []);
                model.setItem('referenceObjectName', null);
                doFilterItems();

                renderSearchBox();
                renderStats();
                renderToolbar();
                renderAvailableItems();
                renderSelectedItems();
            });

            /*
             * Issued when there is an update for this param.
             */
            channel.on('update', (message) => {
                model.setItem('value', message.value);
                updateInputControl('value');
            });

            /*
             * Called when for an update to any param. This is necessary for
             * any parameter which has a dependency upon any other.
             *
             */

            if (subdataInfo.params.dependencies) {
                subdataInfo.params.dependencies.forEach((paramId) => {
                    channel.listen({
                        key: {
                            type: 'parameter-changed',
                            parameter: paramId,
                        },
                        handle: function (message) {
                            updateParam(paramId, message.newValue);
                        },
                    });

                    channel.listen({
                        key: {
                            type: 'parameter-value',
                            parameter: paramId,
                        },
                        handle: function (message) {
                            updateParam(paramId, message.newValue);
                        },
                    });
                    channel
                        .request(
                            {
                                parameterName: paramId,
                            },
                            {
                                key: {
                                    type: 'get-parameter',
                                },
                            }
                        )
                        .then((message) => {
                            updateParam(paramId, message.value);
                        })
                        .catch((err) => {
                            console.warn('ERROR getting parameter', err);
                        });
                });
            }

            // This control has a dependency relationship in that its
            // selection of available values is dependent upon a sub-property
            // of an object referenced by another parameter.
            // Rather than explicitly refer to that parameter, we have a
            // generic capability to receive updates for that value, after
            // which we re-fetch the values, and re-render the control.

            channel
                .request(
                    {
                        parameterName: spec.id,
                    },
                    {
                        key: {
                            type: 'get-parameter',
                        },
                    }
                )
                .then(() => {
                    // console.log('Now i got it again', message);
                });
        }

        // MODIFICATION EVENTS

        /*
         * More refinement of modifications.
         *
         * - initial run
         * - reference data updated
         *   - added "reset" method to props (model) to allow graceful zapping
         *     of the model state.
         * - item added to selected
         * - item removed from selected
         * - search term available
         * - search term removed
         * - filtered data updated
         *
         */

        // LIFECYCLE API

        function start(arg) {
            return Promise.try(() => {
                parent = arg.node;
                container = parent.appendChild(document.createElement('div'));
                ui = UI.make({
                    node: container,
                });

                const events = Events.make(),
                    theLayout = layout(events);

                container.innerHTML = theLayout.content;

                if (config.initialValue) {
                    model.setItem('selectedItems', config.initialValue);
                }

                render();

                events.attachEvents(container);

                registerEvents();

                channel.emit('sync-params', {
                    parameters: subdataInfo.params.dependencies,
                });
            });
        }

        function stop() {
            return Promise.try(() => {
                if (parent && container) {
                    parent.removeChild(container);
                }
                busConnection.stop();
            });
        }

        // MAIN

        return {
            start,
            stop,
        };
    }

    return {
        make: function (config) {
            return factory(config);
        },
    };
});
