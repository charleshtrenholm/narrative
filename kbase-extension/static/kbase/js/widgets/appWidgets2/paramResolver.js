define([
    'bluebird',
    'require',
    './input/checkboxInput',
    './input/customInput',
    './input/customSubdataInput',
    './input/dynamicDropdownInput',
    './input/fileInput',
    './input/floatInput',
    './input/intInput',
    './input/newObjectInput',
    './input/select2ObjectInput',
    './input/selectInput',
    './input/subdataInput',
    './input/taxonomyRefInput',
    './input/textareaInput',
    './input/textInput',
    './input/toggleButtonInput',
    './input/undefinedInput',
    './view/checkboxView',
    './view/customView',
    './view/customSubdataView',
    './view/dynamicDropdownView',
    './view/fileView',
    './view/floatView',
    './view/intView',
    './view/newObjectView',
    './view/select2ObjectView',
    './view/selectView',
    './view/subdataView',
    './view/taxonomyRefView',
    './view/textareaView',
    './view/textView',
    './view/toggleButtonView',
    './view/undefinedView',
], (
    Promise,
    require,
    checkboxInput,
    customInput,
    customSubdataInput,
    dynamicDropdownInput,
    fileInput,
    floatInput,
    intInput,
    newObjectInput,
    select2ObjectInput,
    selectInput,
    subdataInput,
    taxonomyRefInput,
    textareaInput,
    textInput,
    toggleButtonInput,
    undefinedInput,
    checkboxView,
    customView,
    customSubdataView,
    dynamicDropdownView,
    fileView,
    floatView,
    intView,
    newObjectView,
    select2ObjectView,
    selectView,
    subdataView,
    taxonomyRefView,
    textareaView,
    textView,
    toggleButtonView,
    undefinedView
) => {
    'use strict';

    const inputModules = {
        './input/checkboxInput': checkboxInput,
        './input/customInput': customInput,
        './input/customSubdataInput': customSubdataInput,
        './input/dynamicDropdownInput': dynamicDropdownInput,
        './input/fileInput': fileInput,
        './input/floatInput': floatInput,
        './input/intInput': intInput,
        './input/newObjectInput': newObjectInput,
        './input/select2ObjectInput': select2ObjectInput,
        './input/selectInput': selectInput,
        './input/subdataInput': subdataInput,
        './input/taxonomyRefInput': taxonomyRefInput,
        './input/textareaInput': textareaInput,
        './input/textInput': textInput,
        './input/toggleButtonInput': toggleButtonInput,
        './input/undefinedInput': undefinedInput,
        './view/checkboxView': checkboxView,
        './view/customView': customView,
        './view/customSubdataView': customSubdataView,
        './view/dynamicDropdownView': dynamicDropdownView,
        './view/fileView': fileView,
        './view/floatView': floatView,
        './view/intView': intView,
        './view/newObjectView': newObjectView,
        './view/select2ObjectView': select2ObjectView,
        './view/selectView': selectView,
        './view/subdataView': subdataView,
        './view/taxonomyRefView': taxonomyRefView,
        './view/textareaView': textareaView,
        './view/textView': textView,
        './view/toggleButtonView': toggleButtonView,
        './view/undefinedView': undefinedView,
    };

    function factory() {
        function getWidgetModule(spec) {
            const dataType = spec.data.type,
                controlType = spec.ui.control;

            switch (dataType) {
                case 'string':
                    switch (controlType) {
                        case 'textarea':
                        case 'file':
                            return controlType;

                        case 'custom_textsubdata':
                            return 'customSubdata';
                        case 'dropdown':
                            return 'select';
                        case 'autocomplete':
                            return 'taxonomyRef';
                        case 'dynamic_dropdown':
                            return 'dynamicDropdown';
                        case 'text':
                        default:
                            return 'text';
                    }
                case 'sequence':
                case 'float':
                case 'subdata':
                case 'customSubdata':
                case 'struct':
                case 'custom':
                    return dataType;
                case 'boolean':
                    return 'toggleButton';
                case 'int':
                    return controlType === 'checkbox' ? controlType : dataType;
                case 'workspaceObjectRef':
                    switch (spec.ui.class) {
                        case 'input':
                        case 'parameter':
                            return 'select2Object';
                        default:
                            return 'undefined';
                    }
                // IS THIS used anywhere other than in output areas??
                case 'workspaceObjectName':
                    switch (spec.ui.class) {
                        case 'parameter':
                        case 'output':
                            return 'newObject';
                        default:
                            return 'undefined';
                    }
                default:
                    console.error('ERROR could not determine control modules for this spec', spec);
                    throw new Error('Could not determine control modules for this spec');
            }
        }

        function loadModule(type, name) {
            return new Promise((resolve, reject) => {
                require(['./' + type + '/' + name], (Module) => {
                    resolve(Module);
                }, (err) => {
                    reject(err);
                });
            });
        }

        function loadInputControl(parameterSpec) {
            const module = getWidgetModule(parameterSpec);
            // the sequence(Input|View) and struct(Input|View) modules
            // require ParamResolver, so have to be loaded dynamically
            if (module === 'sequence' || module === 'struct') {
                return loadModule('input', `${module}Input`);
            }
            return Promise.resolve(inputModules[`./input/${module}Input`]);
        }

        function loadViewControl(parameterSpec) {
            const module = getWidgetModule(parameterSpec);
            // the sequence(Input|View) and struct(Input|View) modules
            // require ParamResolver, so have to be loaded dynamically
            if (module === 'sequence' || module === 'struct') {
                return loadModule('view', `${module}View`);
            }
            return Promise.resolve(inputModules[`./view/${module}View`]);
        }

        return {
            loadInputControl,
            loadViewControl,
        };
    }
    return {
        make: function () {
            return factory();
        },
    };
});
