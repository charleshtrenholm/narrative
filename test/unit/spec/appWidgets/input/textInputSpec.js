define(['common/runtime', 'widgets/appWidgets2/input/textInput', 'testUtil'], (
    Runtime,
    TextInput,
    TestUtil
) => {
    'use strict';
    let testConfig;
    const required = false,
        defaultValue = 'some test text';

    function buildTestConfig(_required, _defaultValue, _bus) {
        return {
            bus: _bus,
            parameterSpec: {
                data: {
                    defaultValue: _defaultValue,
                    nullValue: '',
                    constraints: {
                        required: _required,
                        defaultValue: _defaultValue,
                    },
                },
            },
            channelName: _bus.channelName,
        };
    }

    function startWidgetAndSetTextField(widget, container, inputText) {
        widget.start({ node: container }).then(() => {
            const inputElem = container.querySelector('input[data-element="input"]');
            inputElem.value = inputText;
            inputElem.dispatchEvent(new Event('change'));
        });
    }

    describe('The Text Input widget', () => {
        let bus, widget, container, runtime;
        beforeEach(() => {
            runtime = Runtime.make();
            container = document.createElement('div');
            bus = runtime.bus().makeChannelBus({
                description: 'text input testing',
            });
            testConfig = buildTestConfig(required, defaultValue, bus);
            widget = TextInput.make(testConfig);
        });

        afterEach(() => {
            bus.stop();
            runtime.destroy();
            container.remove();
            TestUtil.clearRuntime();
        });

        it('should be defined', () => {
            expect(TextInput).not.toBeNull();
        });

        it('should be instantiable', () => {
            expect(widget).toEqual(jasmine.any(Object));
            ['start', 'stop'].forEach((fn) => {
                expect(widget[fn]).toEqual(jasmine.any(Function));
            });
        });

        it('Should start and stop a widget', (done) => {
            widget
                .start({ node: container })
                .then(() => {
                    // verify it's there.
                    const inputElem = container.querySelector('input[data-element="input"]');
                    expect(inputElem).toBeDefined();
                    return widget.stop();
                })
                .then(() => {
                    // verify it's gone.
                    expect(container.childElementCount).toBe(0);
                    done();
                });
        });

        it('Should update value via bus', (done) => {
            // start with one value, change it, then reset.
            // check along the way.
            bus.on('validation', (message) => {
                expect(message.isValid).toBeTruthy();
                done();
            });
            widget.start({ node: container }).then(() => {
                bus.emit('update', { value: 'some text' });
            });
        });

        it('Should reset to default via bus', (done) => {
            bus.on('validation', (message) => {
                expect(message.isValid).toBeTruthy();
                done();
            });
            widget.start({ node: container }).then(() => {
                bus.emit('reset-to-defaults');
            });
        });

        it('Should respond to input change events with "changed"', (done) => {
            const inputText = 'here is some text';
            bus.on('changed', (message) => {
                expect(message.newValue).toEqual(inputText);
                done();
            });
            startWidgetAndSetTextField(widget, container, inputText);
        });

        it('Should respond to input change events with "validation"', (done) => {
            const inputText = 'here is some text';
            bus.on('validation', (message) => {
                expect(message.isValid).toBeTruthy();
                expect(message.errorMessage).toBeUndefined();
                done();
            });
            startWidgetAndSetTextField(widget, container, inputText);
        });

        xit('Should respond to keyup change events with "validation"', (done) => {
            const inputText = 'here is some text';
            bus.on('validation', (message) => {
                expect(message.isValid).toBeTruthy();
                expect(message.errorMessage).toBeUndefined();
                done();
            });
            widget.start({ node: container }).then(() => {
                const inputElem = container.querySelector('input[data-element="input"]');
                inputElem.value = inputText;
                inputElem.dispatchEvent(new Event('keyup'));
            });
        });

        it('Should show message when configured', (done) => {
            testConfig.showOwnMessages = true;
            widget = TextInput.make(testConfig);
            const inputText = 'some text';
            bus.on('validation', (message) => {
                expect(message.isValid).toBeTruthy();
                // ...detect something?
                done();
            });
            startWidgetAndSetTextField(widget, container, inputText);
        });

        it('Should return a diagnosis of required-missing if so', (done) => {
            testConfig = buildTestConfig(true, '', bus);
            widget = TextInput.make(testConfig);
            const inputText = null;
            bus.on('validation', (message) => {
                expect(message.isValid).toBeFalsy();
                expect(message.diagnosis).toBe('required-missing');
                // ...detect something?
                done();
            });
            startWidgetAndSetTextField(widget, container, inputText);
        });
    });
});
