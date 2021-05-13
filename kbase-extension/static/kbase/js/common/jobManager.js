define(['common/jobMessages'], (JobMessages) => {
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

    class JobManager {
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

    return JobManager;
});
