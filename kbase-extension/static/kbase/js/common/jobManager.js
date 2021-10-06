define(['common/dialogMessages', 'common/jobs'], (DialogMessages, Jobs) => {
    'use strict';

    const validOutgoingMessageTypes = [
        'job-does-not-exist',
        'job-error',
        'job-info',
        'job-logs',
        'job-retry-response',
        'job-status',
        'result',
        'run-status',
    ];

    const jobCommand = {
        cancel: {
            command: 'request-job-cancel',
            listener: 'job-status',
        },
        retry: {
            command: 'request-job-retry',
            listener: 'job-retry-response',
        },
    };

    class JobManagerCore {
        /**
         * Initialise the job manager
         *
         * @param {object} config with keys
         *  {object}    model: cell model, including job information under `exec.jobs`
         *  {object}    bus: the bus for communicating messages to the kernel
         *
         * @returns {object} the initialised job manager
         */
        constructor(config) {
            ['bus', 'model'].forEach((key) => {
                if (!config[key]) {
                    throw new Error(
                        'cannot initialise job manager widget without params "bus" and "model"'
                    );
                }
                this[key] = config[key];
            });
            // an object containing event handlers, categorised by event name
            this.handlers = {};
            // bus listeners, indexed by job ID then message type
            this.listeners = {};
        }

        _isValidEvent(event) {
            return event && validOutgoingMessageTypes.concat('modelUpdate').includes(event);
        }

        _isValidMessage(type, message) {
            switch (type) {
                case 'job-status':
                    return message.jobId && Jobs.isValidJobStateObject(message.jobState);
                case 'job-info':
                    return message.jobId && Jobs.isValidJobInfoObject(message.jobInfo);
                case type.indexOf('job') !== -1:
                    return !!message.jobId;
                default:
                    return true;
            }
        }

        /**
         * Add one or more handlers to the job manager; these are executed when one of the
         * valid job-related events occurs (job-related message received, model updated)
         * or when `runHandler` is executed.
         *
         * By default, the handler functions receive the jobManager context as
         * first argument and any additional arguments passed in by the caller
         * (e.g. the message and job ID in the case of job listeners)
         *
         * @param {string} event - event that triggers the handler
         * @param {object} handlerObject with the handler name as keys and the handler function as values
         */

        addEventHandler(event, handlerObject) {
            if (!this._isValidEvent(event)) {
                throw new Error(`addEventHandler: invalid event ${event} supplied`);
            }

            if (
                !handlerObject ||
                Object.prototype.toString.call(handlerObject) !== '[object Object]' ||
                Object.keys(handlerObject).length === 0
            ) {
                throw new Error(
                    'addEventHandler: invalid handlerObject supplied (must be of type object)'
                );
            }

            const errors = [];
            if (!this.handlers[event]) {
                this.handlers[event] = {};
            }

            for (const [name, handlerFn] of Object.entries(handlerObject)) {
                if (typeof handlerFn !== 'function') {
                    errors.push(name);
                } else if (this.handlers[event][name]) {
                    console.warn(`A handler with the name ${name} already exists`);
                } else {
                    this.handlers[event][name] = handlerFn;
                }
            }
            if (errors.length) {
                throw new Error(
                    `Handlers must be of type function. Recheck these handlers: ${errors
                        .sort()
                        .join(', ')}`
                );
            }
        }

        /**
         * Remove a handler from an event
         *
         * @param {string} event
         * @param {string} handlerName
         * @returns {function} handlerFunction
         */
        removeEventHandler(event, handlerName) {
            if (this.handlers[event]) {
                const handlerFunction = this.handlers[event][handlerName];
                delete this.handlers[event][handlerName];
                return handlerFunction;
            }
        }

        /**
         * Trigger the ${event} handlers. Event handlers are executed alphabetically by name.
         *
         * By default, the handler functions receive the jobManager context as
         * first argument and any additional arguments passed in by the caller
         * (e.g. the message and job ID in the case of job listeners)
         *
         * @param {string} event
         * @param  {...any} args
         */
        runHandler(event, ...args) {
            if (
                !this._isValidEvent(event) ||
                !this.handlers[event] ||
                !Object.keys(this.handlers[event])
            ) {
                return;
            }

            Object.keys(this.handlers[event])
                .sort()
                .forEach((name) => {
                    try {
                        this.handlers[event][name](this, ...args);
                    } catch (err) {
                        console.warn(`Error executing handler ${name}:`, err);
                    }
                });
        }

        /* JOB LISTENERS */

        /**
         * Add a bus listener for ${event} messages
         *
         * @param {string} type - a valid message type to listen for (see validOutgoingMessageTypes)
         * @param {array} jobIdList - array of job IDs to apply the listener to
         * @param {object} handlerObject (optional) - object with key(s) handler name and value(s) function to execute on receiving a message
         */
        addListener(type, jobIdList, handlerObject) {
            if (!validOutgoingMessageTypes.includes(type)) {
                throw new Error(`addListener: invalid listener ${type} supplied`);
            }

            if (Object.prototype.toString.call(jobIdList) !== '[object Array]') {
                jobIdList = [jobIdList];
            }

            jobIdList
                .filter((jobId) => {
                    return jobId && jobId.length > 0 ? 1 : 0;
                })
                .forEach((jobId) => {
                    if (!this.listeners[jobId]) {
                        this.listeners[jobId] = {};
                    }

                    if (!this.listeners[jobId][type]) {
                        this.listeners[jobId][type] = this.bus.listen({
                            channel: {
                                jobId,
                            },
                            key: {
                                type,
                            },
                            handle: (message) => {
                                if (!this._isValidMessage(type, message)) {
                                    return;
                                }
                                this.runHandler(type, message, jobId);
                            },
                        });
                    }
                });

            // add the handler -- the message type is used as the event
            if (handlerObject) {
                this.addEventHandler(type, handlerObject);
            }
        }

        /**
         * Remove the listener for ${type} messages for a job ID
         *
         * @param {string} jobId
         * @param {string} type - the type of the listener
         */
        removeListener(jobId, type) {
            try {
                this.bus.removeListener(this.listeners[jobId][type]);
                delete this.listeners[jobId][type];
            } catch (err) {
                // do nothing
            }
        }

        /**
         * Remove all listeners associated with a certain job ID
         * @param {string} jobId
         */
        removeJobListeners(jobId) {
            if (this.listeners[jobId] && Object.keys(this.listeners[jobId]).length) {
                Object.keys(this.listeners[jobId]).forEach((type) => {
                    this.removeListener(jobId, type);
                });
                delete this.listeners[jobId];
            }
        }

        /**
         * Update the model with the supplied jobState objects
         * @param {array} jobArray list of jobState objects to update the model with
         */
        updateModel(jobArray) {
            const jobIndex = this.model.getItem('exec.jobs');
            const batchId = this.model.getItem('exec.jobState.job_id');
            let batchJob;
            jobArray.forEach((jobState) => {
                // update the job object
                jobIndex.byId[jobState.job_id] = jobState;
                if (jobState.job_id === batchId) {
                    batchJob = jobState;
                }
            });
            this.model.setItem('exec.jobs', jobIndex);
            // check whether the batch parent needs updating
            if (batchJob) {
                this.model.setItem('exec.jobState', batchJob);
            }
            this.runHandler('modelUpdate', jobArray);
            return this.model;
        }

        /* UTIL FUNCTIONS */

        _checkStates(statusList, validStates) {
            if (validStates && validStates.length) {
                const allInTheList = statusList.every((status) => {
                    return validStates.includes(status);
                });
                if (!allInTheList) {
                    console.error(
                        `Invalid status supplied! Valid statuses: ${validStates.join(
                            '; '
                        )}; supplied: ${statusList.join('; ')}.`
                    );
                    return null;
                }
            }
            return statusList;
        }

        /**
         * Get jobs with a certain status, excluding the batch parent job
         *
         * @param {array} statusList - array of statuses to find
         * @param {array} validStates - array of valid statuses for this action (optional)
         * @returns {array} job IDs
         */
        getCurrentJobIDsByStatus(rawStatusList, validStates) {
            return this.getCurrentJobsByStatus(rawStatusList, validStates).map((job) => {
                return job.job_id;
            });
        }

        /**
         * Get jobs with a certain status, excluding the batch parent job
         *
         * @param {array} statusList - array of statuses to find
         * @param {array} validStates - array of valid statuses for this action (optional)
         * @returns {array} job objects
         */
        getCurrentJobsByStatus(rawStatusList, validStates) {
            const statusList = this._checkStates(rawStatusList, validStates);
            const jobsById = this.model.getItem('exec.jobs.byId');
            if (!statusList || !jobsById || !Object.keys(jobsById).length) {
                return [];
            }
            const batchId = this.model.getItem('exec.jobState.job_id');

            // this should only use current jobs
            const currentJobs = Jobs.getCurrentJobs(Object.values(jobsById));

            // return only jobs with the appropriate status and that are not the batch parent
            return Object.keys(currentJobs)
                .filter((job_id) => {
                    return statusList.includes(currentJobs[job_id].status) && job_id !== batchId;
                })
                .map((job_id) => {
                    return currentJobs[job_id];
                });
        }
    }

    /**
     * A set of generic message handlers
     *
     * @param {class} Base
     * @returns
     */
    const DefaultHandlerMixin = (Base) =>
        class extends Base {
            constructor(config) {
                // run the constructor for the base class
                super(config);
                this.addDefaultHandlers();
            }

            addDefaultHandlers() {
                const defaultHandlers = {
                    'job-does-not-exist': this.handleJobDoesNotExist,
                    'job-info': this.handleJobInfo,
                    'job-retry-response': this.handleJobRetry,
                    'job-status': this.handleJobStatus,
                };

                Object.keys(defaultHandlers).forEach((event) => {
                    this.addEventHandler(event, {
                        __default: defaultHandlers[event],
                    });
                }, this);
            }

            /**
             * parse job info and update the appropriate part of the model
             *
             * @param {object} message
             */
            handleJobInfo(self, message) {
                const { jobInfo, error } = message;
                if (error) {
                    return;
                }
                self.model.setItem(`exec.jobs.info.${jobInfo.job_id}`, jobInfo);
                self.removeListener(jobInfo.job_id, 'job-info');
            }

            handleJobRetry(self, message) {
                const { job, retry, error } = message;
                if (error) {
                    return;
                }

                // request job updates for the new job
                self.addListener('job-status', [retry.jobState.job_id]);
                self.bus.emit('request-job-updates-start', {
                    jobId: retry.jobState.job_id,
                });
                // update the model with the job data
                self.updateModel(
                    [job, retry].map((j) => {
                        return j.jobState;
                    })
                );
            }

            handleJobDoesNotExist(self, message) {
                const { jobId } = message;
                self.handleJobStatus(self, {
                    jobId,
                    jobState: {
                        job_id: jobId,
                        status: 'does_not_exist',
                    },
                });
            }

            /**
             * @param {Object} message
             */
            handleJobStatus(self, message) {
                const { jobId, jobState } = message;
                const { status, updated } = jobState;

                // if the job is in a terminal state and cannot be retried,
                // stop listening for updates
                if (Jobs.isTerminalStatus(status) && !Jobs.canRetry(jobState)) {
                    self.removeListener(jobId, 'job-status');
                    if (status === 'does_not_exist') {
                        self.removeJobListeners(jobId);
                    }
                    self.bus.emit('request-job-updates-stop', {
                        jobId,
                    });
                    self.updateModel([jobState]);
                    return;
                }

                // check if the job object has been updated since we last saved it
                const previousUpdate = self.model.getItem(`exec.jobs.byId.${jobId}.updated`);
                if (updated && previousUpdate === updated) {
                    return;
                }

                if (jobState.batch_job) {
                    const missingJobIds = [];
                    // do we have all the children?
                    jobState.child_jobs.forEach((job_id) => {
                        if (!self.model.getItem(`exec.jobs.byId.${job_id}`)) {
                            missingJobIds.push(job_id);
                        }
                    });
                    if (missingJobIds.length) {
                        self.addListener('job-status', missingJobIds);
                        self.addListener('job-info', missingJobIds);
                        self.bus.emit('request-job-updates-start', {
                            jobIdList: missingJobIds,
                        });
                    }
                }

                // otherwise, update the state
                self.updateModel([jobState]);
            }
        };

    const JobActionsMixin = (Base) =>
        class extends Base {
            /* JOB ACTIONS */

            /**
             * Cancel or retry a list of jobs
             *
             * @param {string} action - either 'cancel' or 'retry'
             * @param {array} jobIdList
             */
            doJobAction(action, jobIdList) {
                this.bus.emit(jobCommand[action].command, {
                    jobIdList,
                });
                // add the appropriate listener
                this.addListener(jobCommand[action].listener, jobIdList);
            }

            /**
             *
             * @param {object} args with keys
             *      action  {string} the action to perform -- cancel or retry
             *      jobId   {string} job to perform it on
             *
             * @returns {boolean}
             */
            executeActionOnJobId(args) {
                const { action, jobId } = args;
                const jobState = this.model.getItem(`exec.jobs.byId.${jobId}`);
                if (jobState && Jobs.canDo(action, jobState)) {
                    const actionJobId =
                        action === 'retry' && jobState.retry_parent ? jobState.retry_parent : jobId;
                    this.doJobAction(action, [actionJobId]);
                    return true;
                }
                return false;
            }

            /**
             *
             * @param {object} args with keys
             *      action:        {string} action to perform (cancel or retry)
             *      statusList:    {array}  list of statuses to perform it on
             *
             * @returns {Promise} that resolves to false if there is some error with the input or
             * if the user cancels the batch action. If the users confirms the action, the appropriate
             * message will be emitted by the bus.
             */
            executeActionByJobStatus(args) {
                const { action, statusList } = args;
                // valid actions: cancel or retry
                if (!['cancel', 'retry'].includes(action)) {
                    return Promise.resolve(false);
                }

                const jobList = this.getCurrentJobsByStatus(
                    statusList,
                    Jobs.validStatusesForAction[action]
                );
                if (!jobList || !jobList.length) {
                    return Promise.resolve(false);
                }

                return DialogMessages.showDialog({
                    action: `${action}Jobs`,
                    statusList,
                    jobList,
                }).then((confirmed) => {
                    if (confirmed) {
                        const jobIdList =
                            action === 'retry'
                                ? // return the retry_parent (if available)
                                  jobList.map((job) => {
                                      return job.retry_parent || job.job_id;
                                  })
                                : jobList.map((job) => {
                                      return job.job_id;
                                  });
                        this.doJobAction(action, jobIdList);
                    }
                    return Promise.resolve(confirmed);
                });
            }

            /**
             * Cancel a single job from the batch
             *
             * @param {string} jobId
             */
            cancelJob(jobId) {
                return this.executeActionOnJobId({ jobId, action: 'cancel' });
            }

            /**
             * Retry a single job from the batch
             *
             * @param {string} jobId
             */
            retryJob(jobId) {
                return this.executeActionOnJobId({ jobId, action: 'retry' });
            }

            /**
             * Cancel all jobs with the specified statuses
             *
             * @param {array} statusList - array of statuses to cancel
             */
            cancelJobsByStatus(statusList) {
                return this.executeActionByJobStatus({
                    action: 'cancel',
                    statusList: statusList,
                    validStatuses: Jobs.validStatusesForAction.cancel,
                });
            }

            /**
             * Retry all jobs that ended with the specified status(es)
             * Although only jobs in status 'error' or 'terminated' can be retried,
             * the frontend job status may be out of date, so it is left to ee2 to
             * verify whether a job can be retried or not.
             *
             * @param {array} statusList - array of statuses to retry
             */
            retryJobsByStatus(statusList) {
                return this.executeActionByJobStatus({
                    action: 'retry',
                    statusList: statusList,
                    validStatuses: Jobs.validStatusesForAction.retry,
                });
            }

            /**
             * Cancel a batch job by submitting a cancel request for the batch job container
             *
             * This action is triggered by hitting the 'Cancel' button at the top right of the
             * bulk cell
             */
            cancelBatchJob() {
                const batchId = this.model.getItem('exec.jobState.job_id');
                if (batchId) {
                    this.doJobAction('cancel', [batchId]);
                }
                this.resetJobs();
            }

            /**
             * Reset the job manager, removing all listeners and stored job data
             */
            resetJobs() {
                const allJobs = this.model.getItem('exec.jobs.byId'),
                    batchJob = this.model.getItem('exec.jobState');
                if (!allJobs || !Object.keys(allJobs).length) {
                    this.model.deleteItem('exec');
                    return;
                }

                if (batchJob && !allJobs[batchJob.job_id]) {
                    allJobs[batchJob.job_id] = batchJob;
                }

                this.bus.emit('request-job-updates-stop', {
                    batchId: batchJob.job_id,
                });

                // ensure that job updates are turned off and listeners removed
                Object.keys(allJobs).forEach((jobId) => {
                    this.removeJobListeners(jobId);
                });

                this.model.deleteItem('exec');
            }
        };

    const BatchInitMixin = (Base) =>
        class extends Base {
            /**
             * set up the job manager to handle a batch job
             *
             * @param {object} batchJob - with keys
             *        {string} batch_id
             *        {array}  child_job_ids
             */
            initBatchJob(batchJob) {
                const { batch_id, child_job_ids } = batchJob;

                if (
                    !batch_id ||
                    !child_job_ids ||
                    Object.prototype.toString.call(child_job_ids) !== '[object Array]' ||
                    !child_job_ids.length
                ) {
                    throw new Error('Batch job must have a batch ID and at least one child job ID');
                }
                const allJobIds = [batch_id].concat(child_job_ids),
                    // create the child jobs
                    allJobs = child_job_ids.map((job_id) => {
                        return {
                            job_id: job_id,
                            batch_id: batch_id,
                            status: 'created',
                            created: 0,
                        };
                    });

                // add the parent job
                allJobs.push({
                    job_id: batch_id,
                    batch_id: batch_id,
                    batch_job: true,
                    status: 'created',
                    created: 0,
                });

                Jobs.populateModelFromJobArray(this.model, Object.values(allJobs));

                this._initJobs({ allJobIds, batchId: batch_id });

                // request job info
                this.addListener('job-info', allJobIds);
                this.bus.emit('request-job-info', { batchId: batch_id });
            }

            _initJobs(args) {
                const { allJobIds, batchId } = args;

                this.addListener('job-status', allJobIds);
                this.addListener('job-does-not-exist', allJobIds);
                // request job updates
                this.bus.emit('request-job-updates-start', { batchId });
            }

            restoreFromSaved() {
                const batchJob = this.model.getItem('exec.jobState'),
                    allJobs = this.model.getItem('exec.jobs.byId');
                if (!batchJob || !allJobs) {
                    return;
                }
                this._initJobs({
                    batchId: batchJob.job_id,
                    allJobIds: Object.keys(allJobs),
                });
                return this.getFsmStateFromJobs();
            }

            /**
             * Use the current jobs to work out the FSM state
             * @returns {string} bulk import cell FSM state
             */
            getFsmStateFromJobs() {
                return Jobs.getFsmStateFromJobs(this.model.getItem('exec.jobs'));
            }
        };

    class JobManager extends BatchInitMixin(JobActionsMixin(DefaultHandlerMixin(JobManagerCore))) {}

    return {
        JobManagerCore,
        DefaultHandlerMixin,
        JobActionsMixin,
        BatchInitMixin,
        JobManager,
    };
});
