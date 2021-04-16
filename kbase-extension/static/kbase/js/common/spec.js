/*
 * Provides app spec functionality.
 */

define(['bluebird', 'common/lang', 'common/sdk', 'widgets/appWidgets2/validators/resolver'], (
    Promise,
    lang,
    sdk,
    validationResolver
) => {
    'use strict';

    function factory(config) {
        let spec;

        if (config.spec) {
            spec = config.spec;
        } else if (config.appSpec) {
            spec = sdk.convertAppSpec(config.appSpec);
        } else {
            throw new Error('Either a spec or appSpec must be provided');
        }

        function getSpec() {
            return spec;
        }

        /**
         * Makes a 'model' object (not a view model yet, really, because it's just data) from the
         * given spec.
         * It does this by:
         *  The top level spec is treated as a struct.
         *  The default value for each paraemter is simply set as the value for the given parameter
         *    on a model object.
         *  If appType = "bulkImport", this is further separated into "filePaths" and "params"
         *    sub-objects.
         * @param {string} appType
         */
        function makeDefaultedModel(appType) {
            const model = {};
            spec.parameters.layout.forEach((id) => {
                const paramSpec = spec.parameters.specs[id];
                let modelValue;
                if (paramSpec.data.type === 'struct') {
                    if (paramSpec.data.constraints.required) {
                        modelValue = lang.copy(paramSpec.data.defaultValue);
                    } else {
                        modelValue = paramSpec.data.nullValue;
                    }
                } else {
                    modelValue = lang.copy(paramSpec.data.defaultValue);
                }
                if (appType === 'bulkImport') {
                    model.params[id] = modelValue;
                } else {
                    model[id] = modelValue;
                }
            });
            return model;
        }

        function validateModel(model) {
            // TODO: spec at the top level should be a struct...
            // return;
            const validationMap = {};
            spec.parameters.layout.forEach((id) => {
                const fieldValue = model[id];
                const fieldSpec = spec.parameters.specs[id];
                validationMap[id] = validationResolver.validate(fieldValue, fieldSpec);
            });
            return Promise.props(validationMap);
        }

        /**
         * A trimmed version of validateModel that's specific for a few params.
         * Given an array of parameter ids and an object with key-value-pairs from
         * paramId -> value, validate the set. Only the given parameter ids are validated.
         * Any others are ignored.
         *
         * This returns a Promise that resolves into the a key-value-pair of parameter id ->
         * validation response.
         * @param {array} paramIds - the array of parameter ids to validate
         * @param {object} values - a key-value-pair structure of values to validate. Keys should
         *   be parameter ids.
         */
        function validateParams(paramIds, values) {
            const validationMap = {};
            paramIds.forEach((id) => {
                validationMap[id] = validationResolver.validate(values[id], spec.parameters.specs[id]);
            });
            return Promise.props(validationMap);
        }

        return Object.freeze({
            getSpec,
            makeDefaultedModel,
            validateModel,
            validateParams,
        });
    }

    return {
        make: function (config) {
            return factory(config);
        },
    };
});
