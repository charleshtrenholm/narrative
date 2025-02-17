define([
    'jquery',
    'bluebird',
    'util/jobLogViewer',
    'common/runtime',
    'common/jobs',
    '/test/data/jobsData',
    'testUtil',
], ($, Promise, JobLogViewerModule, Runtime, Jobs, JobsData, TestUtil) => {
    'use strict';

    const { cssBaseClass, stateCssBaseClass, JobLogViewer } = JobLogViewerModule;

    const jobsByStatus = JobsData.jobsByStatus;

    const endStates = ['completed', 'error', 'terminated'];
    const queueStates = ['created', 'estimating', 'queued'];

    const lotsOfLogLines = [];
    let n = 0;
    while (n < 50) {
        n++;
        lotsOfLogLines.push({
            is_error: 0,
            line: `log line ${n}`,
            linepos: n,
        });
    }

    function createLogViewer(context, showHistory = false, logPollInterval = null) {
        context.node = document.createElement('div');
        context.runtimeBus = Runtime.make().bus();
        const args = { showHistory, devMode: true };
        if (logPollInterval) {
            args.logPollInterval = logPollInterval;
        }
        context.jobLogViewerInstance = new JobLogViewer(args);
    }

    /**
     * Format a jobs message
     * @param {string} jobId
     * @param {string} type - one of 'status' or 'logs'
     * @param {object} messageData - optional; extra data to add to the message
     * @returns {array} containing message data and channel data
     */
    function formatMessage(jobId, type, messageData = {}) {
        return [
            Object.assign({}, { jobId }, messageData),
            {
                channel: {
                    jobId,
                },
                key: {
                    type: `job-${type}`,
                },
            },
        ];
    }

    function formatStatusMessage(jobState) {
        return formatMessage(jobState.job_id, 'status', { jobState });
    }

    function formatLogMessage(jobId, logMessages) {
        return formatMessage(jobId, 'logs', {
            logs: {
                first: 0,
                max_lines: logMessages.length,
                lines: logMessages,
            },
        });
    }

    const logLines = [
        {
            is_error: 0,
            line: 'line 1 - log',
            linepos: 1,
            ts: 123456789,
        },
        {
            is_error: 1,
            line: 'line 2 - error',
            linepos: 1,
            ts: 123456790,
        },
        {
            is_error: 0,
            line: 'line 3 - more logs',
            linepos: 3,
            ts: 123456789,
        },
        {
            is_error: 0,
            line: 'line 4 - last log',
            linepos: 4,
            ts: 123456790,
        },
    ];

    /**
     *
     * @param {object} context `this` context, including the node to search for the job status lines
     * @param {boolean} includeHistory whether or not history mode is on
     */

    function testJobStatus(context, includeHistory = false) {
        const statusNode = context.node.querySelector(`.${stateCssBaseClass}__container`);
        const errorNode = context.node.querySelector(`.${stateCssBaseClass}__error_container`);

        const statusLine = context.jobState
            ? context.jobState.meta.createJobStatusLines.line
            : Jobs.jobStatusUnknown[0];

        const errorLine = context.jobState ? context.jobState.meta.errorString || null : null;

        if (!statusNode) {
            fail('tests failed: status node not found');
            return;
        }
        expect(statusNode.textContent).toContain(statusLine);

        if (includeHistory) {
            const history = context.jobState
                ? context.jobState.meta.createJobStatusLines.history
                : Jobs.jobStatusUnknown;
            history.forEach((line) => {
                expect(statusNode.textContent).toContain(line);
            });
        }

        if (errorLine) {
            expect(errorNode.textContent).toContain(errorLine);
        } else {
            expect(errorNode.textContent).toBe('');
        }
    }

    function itHasJobStatus() {
        it('has job status', function () {
            testJobStatus(this);
        });
    }

    function itHasJobStatusHistory() {
        it('has job status history', function () {
            testJobStatus(this, true);
        });
    }

    /**
     * Ensure that the log lines are as they should be
     * @param {*} node the job viewer node
     * @param {array} accumulatedLogLines all log lines posted so far (not just the most recent lines)
     */

    function testJobLogs(node, accumulatedLogLines) {
        if (!accumulatedLogLines.length) {
            // no log lines element
            expect(node.querySelector('[data-element="log-lines"]')).toBeNull();
            // no children of the log panel
            expect(node.querySelector('[data-element="log-panel"]').children.length).toEqual(0);
            return;
        }
        const logLinesList = node.querySelector('[data-element="log-lines"]');
        try {
            expect(logLinesList.children.length).toEqual(accumulatedLogLines.length);
            Array.from(logLinesList.children).forEach((line, ix) => {
                const expectedClass = accumulatedLogLines[ix].is_error
                    ? `${cssBaseClass}__line_text--error`
                    : `${cssBaseClass}__line_text`;
                expect(line).toHaveClass(expectedClass);
                expect(line.textContent).toContain(accumulatedLogLines[ix].line);
            });
        } catch (error) {
            console.error('testJobLogs failed: ', error, 'logLinesList: ' + logLinesList.outerHTML);
            fail(error);
        }
    }

    describe('The job log viewer module', () => {
        it('Should load the module code successfully', () => {
            expect(JobLogViewer).toEqual(jasmine.any(Function));
        });

        it('Should have a css base class', () => {
            expect(cssBaseClass).toEqual(jasmine.any(String));
            expect(cssBaseClass).toEqual('kb-log');
        });
    });

    describe('The job log viewer instance', () => {
        beforeAll(() => {
            TestUtil.clearRuntime();
        });

        beforeEach(function () {
            createLogViewer(this);
        });

        afterEach(function () {
            this.jobLogViewerInstance.stop();
            TestUtil.clearRuntime();
        });

        it('should have methods defined', function () {
            ['start', 'stop'].forEach((fn) => {
                expect(this.jobLogViewerInstance[fn]).toEqual(jasmine.any(Function));
            });
        });

        it('Should fail to start without a node', async () => {
            const jobLogViewerInstance = new JobLogViewer();
            await expectAsync(
                jobLogViewerInstance.start({ jobId: 'fakeJob' })
            ).toBeRejectedWithError(/Requires a node to start/);
        });

        it('Should fail to start without a jobId', async function () {
            const jobLogViewerInstance = new JobLogViewer();
            await expectAsync(
                jobLogViewerInstance.start({ node: this.node })
            ).toBeRejectedWithError(/Requires a job id to start/);
        });

        it('Should start as expected with inputs, and be stoppable', async function () {
            const arg = {
                node: this.node,
                jobId: 'test_job_start',
            };
            await this.jobLogViewerInstance.start(arg);
            expect(this.node.querySelector('div[data-element="status-line"]')).toBeDefined();
            this.jobLogViewerInstance.stop();
            expect(this.node.innerHTML).toBe('');
        });

        it('Should send bus messages requesting job status information at startup', async function () {
            const jobId = 'test_bus_request';
            const arg = {
                node: this.node,
                jobId,
            };
            await this.jobLogViewerInstance.start(arg);

            return new Promise((resolve) => {
                this.runtimeBus.on('request-job-status', (msg) => {
                    expect(msg).toEqual({ jobId });
                    resolve();
                });
            });
        });

        describe('initial widget state', () => {
            describe('should be awaiting job data with no job object', () => {
                beforeEach(async function () {
                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId: 'no state set',
                    });
                });
                itHasJobStatus();
            });

            JobsData.allJobs.forEach((jobState) => {
                describe(`should create a string for status ${jobState.status}`, () => {
                    beforeEach(async function () {
                        this.jobState = jobState;
                        await this.jobLogViewerInstance.start({
                            node: this.node,
                            jobId: jobState.job_id,
                            jobState,
                        });
                    });
                    itHasJobStatus();
                });
            });

            JobsData.invalidJobs.forEach((state) => {
                describe(`should be awaiting job data with dodgy state ${JSON.stringify(
                    state
                )}`, () => {
                    const jobId = 'dodgy_job_state_test';
                    beforeEach(async function () {
                        await this.jobLogViewerInstance.start({
                            node: this.node,
                            jobId,
                            jobState: state,
                        });
                    });
                    itHasJobStatus();
                });
            });
        });

        describe('initial state, history mode on', () => {
            beforeEach(function () {
                createLogViewer(this, true);
            });

            describe('should be awaiting job data with no job object', () => {
                beforeEach(async function () {
                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId: 'no state set, history',
                    });
                });
                itHasJobStatusHistory();
            });

            JobsData.allJobs.forEach((jobState) => {
                describe(`should create an array in history mode for status ${jobState.status}`, () => {
                    beforeEach(async function () {
                        this.jobState = jobState;
                        await this.jobLogViewerInstance.start({
                            node: this.node,
                            jobId: jobState.job_id,
                            jobState,
                        });
                    });
                    itHasJobStatusHistory();
                });
            });
        });

        /**
         * Create a MutationObserver that watches for changes to the job status lines
         *
         * @param {object} context - jasmine 'this' context
         * @param {array} jobMessage - appropriately formatted message and channel data to
         * @returns {Promise} - resolves when there are job status line changes
         */
        function createStatusObserver(context, jobMessage) {
            return TestUtil.waitFor({
                documentElement: context.node.querySelector('[data-element="status-line"]'),
                domStateFunction: (mutations) => {
                    if (!mutations || !mutations.length) {
                        return false;
                    }
                    const result = mutations.some((mut) => {
                        return Array.from(mut.addedNodes).some((domEl) => {
                            return (
                                domEl.classList &&
                                domEl.classList.contains(
                                    `${stateCssBaseClass}__job_status_detail_container`
                                )
                            );
                        });
                    });
                    return result ? true : false;
                },
                executeFirst: () => {
                    if (jobMessage) {
                        context.runtimeBus.send(...jobMessage);
                    }
                },
                config: { childList: true },
            });
        }

        describe('response to update', () => {
            [true, false].forEach((mode) => {
                beforeEach(function () {
                    if (mode) {
                        this.jobLogViewerInstance = new JobLogViewer({
                            showHistory: mode,
                            devMode: true,
                        });
                    }
                });

                JobsData.validJobs.forEach((jobState) => {
                    it(`should create a string for status ${jobState.status}, history mode ${
                        mode ? 'on' : 'off'
                    }`, async function () {
                        this.runtimeBus.on('request-job-status', (msg) => {
                            testJobStatus(this, mode);
                            expect(msg).toEqual({ jobId: jobState.job_id });
                        });

                        await this.jobLogViewerInstance.start({
                            node: this.node,
                            jobId: jobState.job_id,
                        });

                        return createStatusObserver(this, formatStatusMessage(jobState)).then(
                            () => {
                                this.jobState = jobState;
                                testJobStatus(this, mode);
                            }
                        );
                    });
                });
            });

            // job does not exist update
            it('should create a string for an unknown job', async function () {
                const jobState = JobsData.unknownJob;

                this.runtimeBus.on('request-job-status', (msg) => {
                    testJobStatus(this);
                    expect(msg).toEqual({ jobId: jobState.job_id });
                });

                await this.jobLogViewerInstance.start({
                    node: this.node,
                    jobId: jobState.job_id,
                });

                return createStatusObserver(this, formatStatusMessage(jobState)).then(() => {
                    this.jobState = jobState;
                    testJobStatus(this);
                    // the job log container should be empty
                    expect(this.node.querySelector('.kb-log__logs_container').innerHTML).toBe('');
                });
            });

            /**
             * invalid job state objects are ignored by the job log widget, so this test checks
             * that the log viewer does not change when supplied with an invalid object. This is
             * difficult to test without waiting for some timeout event, so instead the test
             * supplies an invalid object and then a valid object. The test finished when a DOM
             * change is detected in the status node area, which should only occur when the valid
             * job state object is received.
             */
            JobsData.invalidJobs.forEach((state) => {
                it(`should not do anything when given dodgy job state ${JSON.stringify(
                    state
                )}`, async function () {
                    const jobId = 'dodgy_job_state_test';
                    let firstCall = true;

                    // this gets called when handleJobStatusUpdate is triggered
                    // the first call will be with the dodgy params,
                    // subsequent calls will be with valid params
                    // when the first call is made, send a job update with a valid job state object
                    spyOn(Jobs, 'isValidJobStateObject').and.callFake((params) => {
                        const response = Jobs.isValidJobStateObject.and.originalFn(params);
                        if (firstCall) {
                            firstCall = false;
                            this.runtimeBus.send(
                                ...formatMessage(jobId, 'status', {
                                    jobState: jobsByStatus['running'][0],
                                })
                            );
                        } else {
                            // this is the DOM state after receiving the first (invalid) job update,
                            // but before receiving the second (valid) update.
                            testJobStatus(this);
                        }
                        return response;
                    });

                    this.runtimeBus.on('request-job-status', (msg) => {
                        expect(msg).toEqual({ jobId });
                        testJobStatus(this);
                        this.runtimeBus.send(
                            ...formatMessage(jobId, 'status', { jobState: state })
                        );
                    });

                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId,
                    });

                    return createStatusObserver(this).then(() => {
                        expect(Jobs.isValidJobStateObject.calls.count()).toEqual(2);
                        const allCallArgs = Jobs.isValidJobStateObject.calls.allArgs();
                        expect(allCallArgs[0][0]).toEqual(state);
                        expect(allCallArgs[1][0]).toEqual(jobsByStatus['running'][0]);
                        this.jobState = jobsByStatus['running'][0];
                        testJobStatus(this);
                    });
                });
            });
        });

        // the log display
        describe('log viewer', () => {
            beforeEach(function () {
                createLogViewer(this, false, 50);
            });

            describe('controls', () => {
                const jobState = jobsByStatus.running[0];
                const jobId = jobState.job_id;
                let jlv, container;

                beforeEach(async function () {
                    jlv = this.jobLogViewerInstance;
                    container = this.node;
                    this.runtimeBus.on('request-job-status', (msg) => {
                        expect(msg).toEqual({ jobId });
                        this.runtimeBus.send(...formatStatusMessage(jobState));
                    });

                    this.runtimeBus.on('request-job-log', (msg) => {
                        expect(msg).toEqual({ jobId, options: { latest: true } });
                        this.runtimeBus.send(...formatLogMessage(jobId, lotsOfLogLines));
                    });

                    document.body.appendChild(this.node);
                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId,
                    });
                    await TestUtil.waitForElementChange(
                        this.node.querySelector('[data-element="log-panel"]')
                    );
                    const logPanelTitle = this.node.querySelector(`.${cssBaseClass}__logs_title`);
                    await TestUtil.waitForElement(this.node, `.${cssBaseClass}__line_text`, () => {
                        logPanelTitle.click();
                    });
                });

                afterEach(async () => {
                    await jlv.stop();
                    container.remove();
                });
                it('Should start with all buttons disabled', async function () {
                    const arg = {
                        node: this.node,
                        jobId,
                    };
                    await this.jobLogViewerInstance.start(arg);
                    const btns = this.node.querySelectorAll('div[data-element="header"] button');
                    btns.forEach((btn) => {
                        expect(btn).toHaveClass('disabled');
                    });
                });

                it('should have an expand button that toggles the log container class', function () {
                    const standardClass = `.${cssBaseClass}__content`,
                        expandedClass = `${standardClass}--expanded`,
                        expandButton = this.node.querySelector(
                            `.${cssBaseClass}__log_button--expand`
                        );

                    expect(this.node.querySelectorAll(standardClass).length).toEqual(1);
                    expect(this.node.querySelectorAll(expandedClass).length).toEqual(0);

                    expandButton.click();
                    expect(this.node.querySelectorAll(standardClass).length).toEqual(0);
                    expect(this.node.querySelectorAll(expandedClass).length).toEqual(1);

                    expandButton.click();
                    expect(this.node.querySelectorAll(standardClass).length).toEqual(1);
                    expect(this.node.querySelectorAll(expandedClass).length).toEqual(0);
                });

                // the next two tests do not pass consistently when run by the test harness
                xit('Should have the top button go to the top', async function () {
                    const logContent = this.node.querySelector('.kb-log__content'),
                        topButton = this.node.querySelector(`.${cssBaseClass}__log_button--top`);
                    // set the scrollTop to the midway point
                    logContent.scrollTop = logContent.clientHeight / 2;

                    await TestUtil.waitForElementChange(logContent, () => {
                        topButton.click();
                    });
                    expect(logContent.scrollTop).toEqual(0);
                });

                xit('Should have the bottom button go to the end', async function () {
                    const logContent = this.node.querySelector('.kb-log__content'),
                        bottomButton = this.node.querySelector(
                            `.${cssBaseClass}__log_button--bottom`
                        );
                    // set the scrollTop to the midway point
                    logContent.scrollTop = logContent.clientHeight / 2;

                    await TestUtil.waitForElementChange(logContent, () => {
                        bottomButton.click();
                    });
                    expect(logContent.scrollTop).not.toEqual(0);
                    expect(logContent.scrollTop).toEqual(
                        logContent.scrollHeight - logContent.clientHeight
                    );
                });

                xit('should have stop and play buttons to turn logs off and on', () => {});
            });

            // job not found: logs container is removed
            it('should not render logs if the job is not found', async function () {
                const jobState = jobsByStatus['does_not_exist'][0];
                const jobId = jobState.job_id;

                this.runtimeBus.on('request-job-status', (msg) => {
                    expect(msg).toEqual({ jobId: jobState.job_id });
                    // send the job message
                    this.runtimeBus.send(...formatStatusMessage(jobState));
                });

                await this.jobLogViewerInstance.start({
                    node: this.node,
                    jobId,
                });

                await TestUtil.waitForElementChange(
                    this.node.querySelector('[data-element="log-container"]')
                );
                // the job log container should be empty
                expect(this.node.querySelector('.kb-log__logs_container').innerHTML).toBe('');
            });

            // queued jobs: message to say that the logs will be available when job runs
            queueStates.forEach((queueState) => {
                it(`should render a queued message for "${queueState}" jobs`, async function () {
                    const jobState = jobsByStatus[queueState][0];
                    const jobId = jobState.job_id;

                    this.runtimeBus.on('request-job-status', (msg) => {
                        expect(msg).toEqual({ jobId: jobState.job_id });
                        // send the job message
                        const jobMessage = formatStatusMessage(jobState);
                        this.runtimeBus.send(...jobMessage);
                    });

                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId,
                    });

                    await TestUtil.waitForElementChange(
                        this.node.querySelector('[data-element="log-panel"]')
                    );
                    expect(this.node.querySelector('[data-element="log-panel"]').textContent).toBe(
                        'Job is queued; logs will be available when the job is running.'
                    );
                });
            });

            // running job: job logs are updated as they are received
            it('Should render job logs whilst job is running', async function () {
                const jobState = jobsByStatus['running'][0];
                const jobId = jobState.job_id;

                // lines to return each time there is a request for the latest logs
                // first request - 0 lines; second: 2 log lines; third: same as second; last: all log lines.
                const logs = [[], logLines.slice(0, 2), logLines.slice(0, 2), logLines]; //
                let acc = 0;

                this.runtimeBus.on('request-job-status', (msg) => {
                    expect(msg).toEqual({ jobId });
                    this.runtimeBus.send(...formatStatusMessage(jobState));
                });

                this.runtimeBus.on('request-job-updates-start', (msg) => {
                    expect(msg).toEqual({ jobId });
                    this.runtimeBus.send(...formatStatusMessage(jobState));
                });

                await this.jobLogViewerInstance.start({
                    node: this.node,
                    jobId,
                });

                return new Promise((resolve) => {
                    this.runtimeBus.on('request-job-log', (msg) => {
                        expect(msg).toEqual({ jobId, options: { latest: true } });
                        const logUpdate = logs[acc];
                        acc += 1;
                        // set up the mutation observer to watch for UI spinner changes
                        // the spinner is shown whenever the log viewer is waiting for logs
                        // and hidden whenever a log update comes in
                        // there are four job logs messages to check for, so once we have seen
                        // all four, resolve the promise and finish the test.
                        const observer = new MutationObserver(() => {
                            testJobLogs(this.node, logUpdate);
                            observer.disconnect();
                            if (logs.length === acc) {
                                resolve();
                            }
                        });
                        observer.observe(this.node.querySelector('[data-element="spinner"]'), {
                            attributes: true,
                            childList: true,
                            subtree: true,
                        });

                        this.runtimeBus.send(...formatLogMessage(jobId, logUpdate));
                    });
                });
            });

            // job running, job logs have been deleted
            it(`should render a message when logs are deleted, state running`, async function () {
                const jobState = jobsByStatus['running'][0];
                const jobId = jobState.job_id;

                this.runtimeBus.on('request-job-status', (msg) => {
                    expect(msg).toEqual({ jobId });
                    this.runtimeBus.send(...formatStatusMessage(jobState));
                });

                this.runtimeBus.on('request-job-updates-start', (msg) => {
                    expect(msg).toEqual({ jobId });
                    this.runtimeBus.send(...formatStatusMessage(jobState));
                });

                // this is called when the state is 'running'
                this.runtimeBus.on('request-job-log', (msg) => {
                    expect(msg).toEqual({ jobId, options: { latest: true } });
                    this.runtimeBus.send(
                        ...formatMessage(jobId, 'logs', {
                            error: 'summat went wrong',
                        })
                    );
                });

                spyOn(console, 'error');
                await this.jobLogViewerInstance.start({
                    node: this.node,
                    jobId,
                });

                await TestUtil.waitForElementChange(
                    this.node.querySelector('[data-element="log-panel"]')
                );
                expect(this.node.querySelector('[data-element="log-panel"]').textContent).toBe(
                    'No log entries to show.'
                );
                expect(this.jobLogViewerInstance.state.awaitingLog).toBeFalse();
                expect(this.jobLogViewerInstance.state.listeningForJob).toBeTrue();
                expect(this.jobLogViewerInstance.state.looping).toBeFalse();

                const allCalls = console.error.calls.allArgs();
                expect(allCalls.length).toEqual(1);
                expect(allCalls[0].length).toEqual(1);
                expect(allCalls[0][0]).toMatch(/Error retrieving log for job.*?summat went wrong/);
            });

            endStates.forEach((endState) => {
                // completed statuses - should be one request for logs
                it(`Should render all job logs if the job status is ${endState}`, async function () {
                    const jobState = jobsByStatus[endState][0];
                    const jobId = jobState.job_id;

                    this.runtimeBus.on('request-job-status', (msg) => {
                        expect(msg).toEqual({ jobId });
                        this.runtimeBus.send(...formatStatusMessage(jobState));
                    });

                    this.runtimeBus.on('request-job-log', (msg) => {
                        expect(msg).toEqual({ jobId, options: { first_line: 0 } });
                        this.runtimeBus.send(...formatLogMessage(jobId, logLines));
                    });

                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId,
                    });

                    await TestUtil.waitForElementChange(
                        this.node.querySelector('[data-element="log-panel"]')
                    );
                    testJobLogs(this.node, logLines);
                });

                // logs deleted: 'No log entries to show' message
                // create a mutation observer to watch for changes to the log-panel node; when those changes
                // occur, `callback` will be run to test that the changes are as expected
                it(`should render a message when logs are deleted, state ${endState}`, async function () {
                    const jobState = jobsByStatus[endState][0];
                    const jobId = jobState.job_id;

                    this.runtimeBus.on('request-job-status', (msg) => {
                        expect(msg).toEqual({ jobId });
                        this.runtimeBus.send(...formatStatusMessage(jobState));
                    });

                    this.runtimeBus.on('request-job-log', (msg) => {
                        expect(msg).toEqual({ jobId, options: { first_line: 0 } });
                        this.runtimeBus.send(
                            ...formatMessage(jobId, 'logs', {
                                error: 'DANGER!',
                            })
                        );
                    });
                    spyOn(console, 'error');
                    await this.jobLogViewerInstance.start({
                        node: this.node,
                        jobId,
                    });
                    await TestUtil.waitForElementChange(
                        this.node.querySelector('[data-element="log-panel"]')
                    );

                    expect(this.node.querySelector('[data-element="log-panel"]').textContent).toBe(
                        'No log entries to show.'
                    );
                    expect(this.jobLogViewerInstance.state.awaitingLog).toBeFalse();
                    expect(this.jobLogViewerInstance.state.looping).toBeFalse();
                    expect(this.jobLogViewerInstance.state.listeningForJob).toBeFalse();
                    const allCalls = console.error.calls.allArgs();
                    expect(allCalls.length).toEqual(1);
                    expect(allCalls[0].length).toEqual(1);
                    expect(allCalls[0][0]).toMatch(/Error retrieving log for job.*?DANGER!/);
                });
            });
        });
    });
});
