define(['common/jobMessages', 'common/jobs'], (JobMessages, Jobs) => {
    'use strict';

    const validOutgoingMessageTypes = [
        'job-cancel-error',
        'job-canceled',
        'job-deleted',
        'job-does-not-exist',
        'job-error',
        'job-info',
        'job-log-deleted',
        'job-logs',
        // NEW
        'job-retried',
        'job-status',
        'result',
        'run-status',
    ];

    const jobCommand = {
        cancel: {
            command: 'request-job-cancellation',
            listener: 'job-canceled',
        },
        retry: {
            command: 'request-job-retry',
            listener: 'job-retried',
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

        addHandler(event, handlerObject) {
            if (!this._isValidEvent(event)) {
                throw new Error(`addHandler: invalid event ${event} supplied`);
            }

            if (
                !handlerObject ||
                Object.prototype.toString.call(handlerObject) !== '[object Object]' ||
                Object.keys(handlerObject).length === 0
            ) {
                throw new Error(
                    'addHandler: invalid handlerObject supplied (must be of type object)'
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
         * Remove a handler
         *
         * @param {string} event
         * @param {string} handlerName
         */
        removeHandler(event, handlerName) {
            if (this.handlers[event]) {
                const handlerFunction = this.handlers[event][handlerName];
                delete this.handlers[event][handlerName];
                return handlerFunction;
            }
        }

        /**
         * Trigger the ${event} handlers. Handlers are executed alphabetically by name.
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

            jobIdList.forEach((jobId) => {
                if (!this.listeners[jobId]) {
                    this.listeners[jobId] = {};
                }

                if (!this.listeners[jobId][type]) {
                    this.listeners[jobId][type] = this.bus.listen({
                        channel: {
                            jobId: jobId,
                        },
                        key: {
                            type: type,
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
                this.addHandler(type, handlerObject);
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
                    this.bus.removeListener(this.listeners[jobId][type]);
                    delete this.listeners[jobId][type];
                });
                delete this.listeners[jobId];
            }
        }

        /* JOB MANAGEMENT */

        /**
         * Get the IDs of jobs with a certain status
         *
         * @param {array} statusList - array of statuses to find
         * @param {array} validStates - array of valid statuses for this action (optional)
         * @returns {array} job IDs to perform the action upon
         */
        getJobIDsByStatus(statusList, validStates) {
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

            const jobsByStatus = this.model.getItem('exec.jobs.byStatus');
            if (!jobsByStatus || !Object.keys(jobsByStatus).length) {
                return null;
            }
            return statusList
                .map((status) => {
                    return jobsByStatus[status] ? Object.keys(jobsByStatus[status]) : [];
                })
                .flat();
        }

        /**
         *
         * @param {object} args with keys
         *                 action {function} the action to perform
         *                 jobId  {string} job to perform it on
         *
         * @returns {boolean}
         */
        executeActionOnJobId(args) {
            const { action, jobId } = args;
            const jobState = this.model.getItem(`exec.jobs.byId.${jobId}`);
            return action([jobState]);
        }

        /**
         *
         * @param {object} args with keys
         *      action:        {function} action to perform
         *      statusList:    {array}  list of statuses to perform it on
         *      validStatuses: {array}  list of statuses that it is valid to perform the action on
         *
         * @returns {Promise} that resolves to false if there is some error with the input or
         * if the user cancels the batch action. If the users confirms the action, the appropriate
         * message will be emitted by the bus.
         */
        executeActionByJobStatus(args) {
            const { action, statusList, validStatuses } = args;
            const jobIdList = this.getJobIDsByStatus(statusList, validStatuses);
            if (!jobIdList || !jobIdList.length) {
                return false;
            }
            // return action(statusList, jobsList);

            return JobMessages.showDialog({ action, statusList, jobIdList }).then((confirmed) => {
                if (confirmed) {
                    this.bus.emit(jobCommand[action], {
                        jobIdList,
                    });
                }
                return confirmed;
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
                validStatuses: ['created', 'estimating', 'queued', 'running'],
            });
        }

        /**
         * Retry all jobs that ended with the specified status(es)
         *
         * @param {array} statusList - array of statuses to retry
         */
        retryJobsByStatus(statusList) {
            return this.executeActionByJobStatus({
                action: 'retry',
                statusList: statusList,
                validStatuses: ['error', 'terminated'],
            });
        }

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
         * Update the model with the supplied jobState objects
         * @param {array} jobArray list of jobState objects to update the model with
         */
        updateModel(jobArray) {
            const jobIndex = this.model.getItem('exec.jobs');
            jobArray.forEach((jobState) => {
                const status = jobState.status,
                    jobId = jobState.job_id,
                    oldJob = jobIndex.byId[jobId];

                // update the job object
                jobIndex.byId[jobId] = jobState;
                if (!jobIndex.byStatus[status]) {
                    jobIndex.byStatus[status] = {};
                }
                jobIndex.byStatus[status][jobId] = true;

                if (oldJob && status !== oldJob.status) {
                    const oldStatus = oldJob.status;
                    delete jobIndex.byStatus[oldStatus][jobId];
                    if (!Object.keys(jobIndex.byStatus[oldStatus]).length) {
                        delete jobIndex.byStatus[oldStatus];
                    }
                }
            });
            this.model.setItem('exec.jobs', jobIndex);
            this.runHandler('modelUpdate', jobArray);
            return this.model;
        }
    }

    const defaultHandlerMixin = (Base) =>
        class extends Base {
            /**
             * parse and update the row with job info
             * @param {object} message
             */
            handleJobInfo(self, message) {
                const jobId = message.jobId;
                self.model.setItem(`exec.jobs.params.${jobId}`, message.jobInfo.job_params[0]);
                self.removeListener(jobId, 'job-info');
            }

            handleJobCancel(self, message) {
                const jobId = message.jobId;
                // request the job status
                self.bus.emit('request-job-status', {
                    jobId,
                });
                // remove the cancel listeners
                self.removeListener(message.jobId, 'job-canceled');
            }

            handleJobRetry(self, message) {
                const jobId = message.jobId,
                    newJobId = message.newJobId;

                // remove all listeners for the original job
                self.removeJobListeners(jobId);

                // copy over the params
                self.model.setItem(
                    `exec.jobs.params.${newJobId}`,
                    self.model.getItem(`exec.jobs.params.${jobId}`)
                );

                // request job updates for the new job
                self.addListener('job-status', [newJobId]);
                self.bus.emit('request-job-update', {
                    jobId: newJobId,
                });
            }

            handleJobDoesNotExist(self, message) {
                const jobId = message.jobId;
                self.handleJobStatus(self, {
                    job_id: jobId,
                    status: 'does_not_exist',
                    created: null,
                });
                self.removeJobListeners(jobId);
            }

            /**
             * Pass the job state to all row widgets
             * @param {Object} message
             */
            handleJobStatus(self, message) {
                const jobState = message.jobState;
                const jobId = jobState.job_id;
                const status = jobState.status;

                self.removeListener(jobId, 'job-does-not-exist');

                if (Jobs.isTerminalStatus(status)) {
                    self.removeListener(jobId, 'job-status');
                    self.bus.emit('request-job-completion', {
                        jobId,
                    });
                }

                // check if the status has changed; if not, ignore this update
                const previousStatus = self.model.getItem(`exec.jobs.byId.${jobId}.status`);
                if (status === previousStatus) {
                    return;
                }
                // otherwise, update the state
                self.updateModel([jobState]);
            }

            setDefaultHandlers() {
                const defaultHandlers = {
                    'job-canceled': this.handleJobCancel,
                    'job-does-not-exist': this.handleJobDoesNotExist,
                    // 'job-error': this.ohShit,
                    'job-info': this.handleJobInfo,
                    // 'job-logs': this.ohShit,
                    'job-retried': this.handleJobRetry,
                    'job-status': this.handleJobStatus,
                };

                Object.keys(defaultHandlers).forEach((event) => {
                    this.addHandler(event, {
                        __default: defaultHandlers[event],
                    });
                }, this);
            }
        };

    const BatchInitMixin = (Base) =>
        class extends Base {
            /**
             * set up the job manager to handle a batch job
             *
             * @param {object} batchJob - with keys
             *        {string} parent_job_id
             *        {array}  child_job_ids
             */
            initBatchJob(batchJob) {
                const { parent_job_id, child_job_ids } = batchJob;

                if (
                    !parent_job_id ||
                    !child_job_ids ||
                    Object.prototype.toString.call(child_job_ids) !== '[object Array]' ||
                    !child_job_ids.length
                ) {
                    throw new Error(
                        'Batch job must have a parent job ID and at least one child job ID'
                    );
                }

                this.setDefaultHandlers();
                this.addListener('job-does-not-exist', child_job_ids);

                this.addListener('job-status', child_job_ids);

                // initialise `exec.jobs` with the new child jobs
                this.model.setItem(
                    'exec.jobs',
                    Jobs.jobArrayToIndexedObject(
                        child_job_ids.map((id) => {
                            return { job_id: id, status: 'created' };
                        })
                    )
                );

                // request updates on the child jobs
                this.bus.emit('request-job-update', {
                    jobIdList: child_job_ids,
                });

                // TODO: what to do about parent?
            }

            getFsmStateFromJobs() {

                const jobsByStatus = this.model.getItem(`exec.jobs.byStatus`)
                if (!jobsByStatus || !Object.keys(jobsByStatus).length) {
                    return null;
                }

                const statuses = {}

                Object.keys(jobsByStatus).forEach((status) => {
                    const nJobs = Object.keys(jobsByStatus[status]).length;
                    // reduce down the queued states
                    if (status === 'estimating' || status === 'created') {
                        status = 'queued';
                    }
                    statuses[status] ? (statuses[status] += nJobs) : (statuses[status] = nJobs);
                });

                if (statuses.running || statuses.queued) {
                    if (statuses.completed) {
                        return 'appPartialComplete'
                    }
                    return 'inProgress'
                }

                if (Object.keys(statuses).length === 1) {
                    if (statuses.terminated) {
                        return 'appCanceled'
                    }
                    if (statuses.completed) {
                        return 'appComplete'
                    }
                    if (statuses.error || statuses.does_not_exist) {
                        return 'appError'
                    }
                }
                // Erk!
                return 'appComplete'
            }
        };

    class JobManager extends BatchInitMixin(defaultHandlerMixin(JobManagerCore)) {}

    return JobManager;
});
