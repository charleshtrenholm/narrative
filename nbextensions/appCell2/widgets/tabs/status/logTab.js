/**
 * This is the entrypoint module for the job status / log viewer tab of the app cell.
 */
define([
    'bluebird',
    'kb_common/html',
    'common/ui',
    'common/runtime',
    'util/jobLogViewer',
    './jobStateList',
    './jobInputParams',
], (Promise, html, UI, Runtime, JobLogViewerModule, JobStateList, JobInputParams) => {
    'use strict';

    const { JobLogViewer } = JobLogViewerModule;

    const t = html.tag,
        div = t('div');

    function factory(config) {
        // The top level node used by this widget.
        let container;

        // The handy UI module interface to this container.
        let ui;
        const widgets = {},
            { model } = config;
        let queueListener,
            selectedJobId = config.jobId;

        /**
         * Used only if we're in Batch mode.
         */
        function batchLayout() {
            const list = div(
                { class: 'col-md-3 batch-mode-col', dataElement: 'kb-job-list-wrapper' },
                [
                    ui.buildPanel({
                        title: 'Job Batch',
                        name: 'subjobs',
                        classes: ['kb-panel-light'],
                    }),
                ]
            );

            const jobStatus = div(
                { class: 'col-md-9 batch-mode-col', dataElement: 'kb-job-status-wrapper' },
                [
                    ui.buildCollapsiblePanel({
                        title: 'Job Params',
                        name: 'job-params-section-toggle',
                        hidden: false,
                        type: 'default',
                        classes: ['kb-panel-container'],
                        body: div({}, [
                            ui.buildPanel({
                                name: 'params',
                                classes: ['kb-panel-light'],
                            }),
                        ]),
                    }),
                    ui.buildCollapsiblePanel({
                        title: 'Job Status and Logs',
                        name: 'job-log-section-toggle',
                        hidden: false,
                        type: 'default',
                        collapsed: true,
                        classes: ['kb-panel-container'],
                        body: div({}, [
                            ui.buildPanel({
                                name: 'log',
                                classes: ['kb-panel-light'],
                            }),
                        ]),
                    }),
                ]
            );
            return div({}, [list, jobStatus]);
        }

        function queueLayout() {
            return div(
                {
                    dataElement: 'kb-job-status-wrapper',
                },
                ['This job is currently queued for execution and will start running soon.']
            );
        }

        function getSelectedJobId() {
            return config.clickedId;
        }

        function startBatch() {
            return Promise.try(() => {
                container.innerHTML = batchLayout();

                //display widgets
                widgets.params = JobInputParams.make({
                    model: model,
                });
                widgets.log = new JobLogViewer({ showHistory: true });

                //rows as widgets to get live update
                widgets.stateList = JobStateList.make({
                    model: model,
                });

                const childJobs = model.getItem('exec.jobState.child_jobs');
                if (childJobs.length > 0) {
                    selectedJobId = childJobs.job_id;
                }
                startDetails({
                    jobId: selectedJobId,
                    isParentJob: true,
                });

                function startDetails(arg) {
                    const jobId = arg.jobId ? arg.jobId : model.getItem('exec.jobState.job_id');
                    config.clickedId = jobId;
                    return Promise.all([
                        widgets.params.start({
                            node: ui.getElement('params.body'),
                            jobId: jobId,
                            parentJobId: model.getItem('exec.jobState.job_id'),
                            isParentJob: arg.isParentJob,
                        }),
                        widgets.log.start({
                            node: ui.getElement('log.body'),
                            jobId: jobId,
                            parentJobId: model.getItem('exec.jobState.job_id'),
                        }),
                    ]);
                }
                return Promise.all([
                    widgets.stateList.start({
                        node: ui.getElement('subjobs.body'),
                        childJobs: model.getItem('exec.jobState.child_jobs'),
                        clickFunction: startDetails,
                        parentJobId: model.getItem('exec.jobState.job_id'),
                        batchSize: model.getItem('exec.jobState.batch_size'),
                    }),
                ]);
            });
        }

        /**
         * Can start in 2 modes.
         * 1. If the app is running, or has ever been running (so, )
         * @param {object} arg
         *  - node - the node to attach this tab to
         *  -
         */
        function start(arg) {
            container = arg.node.appendChild(document.createElement('div'));
            ui = UI.make({
                node: container,
            });

            if (model.getItem('exec.jobState.status') === 'queued') {
                container.innerHTML = queueLayout();
                queueListener = Runtime.make()
                    .bus()
                    .listen({
                        channel: {
                            jobId: model.getItem('exec.jobState.job_id'),
                        },
                        key: {
                            type: 'job-status',
                        },
                        handle: (message) => {
                            if (message.jobState.status !== 'queued') {
                                container.innerHTML = '';
                                Runtime.make().bus().removeListener(queueListener);
                                startNonQueued();
                            }
                        },
                    });
            } else {
                startNonQueued();
            }
        }

        function startNonQueued() {
            const childJobs = model.getItem('exec.jobState.child_jobs');
            if ((childJobs && childJobs.length > 0) || model.getItem('user-settings.batchMode')) {
                startBatch();
            } else {
                startSingle();
            }
        }

        function startSingle() {
            return Promise.try(() => {
                container.innerHTML = div({
                    dataElement: 'log',
                });
                widgets.log = new JobLogViewer({ showHistory: true });
                return widgets.log.start({
                    node: ui.getElement('log'),
                    jobId: model.getItem('exec.jobState.job_id'),
                });
            });
        }

        function stop() {
            return Promise.try(() => {
                if (widgets) {
                    return Promise.all(
                        Object.keys(widgets).map((key) => {
                            return widgets[key].stop();
                        })
                    );
                }
            });
        }

        return {
            start: start,
            stop: stop,
            getSelectedJobId: getSelectedJobId,
        };
    }

    return {
        make: function (config) {
            return factory(config);
        },
    };
});
