define(['./jobsData', 'common/jobs', 'json!./testAppObj.json'], (JobsData, Jobs, TestAppObj) => {
    'use strict';

    const jobRemapping = {
        'job cancelled during run': '60145f8c6fc98a309e1a27e1',
        'job cancelled whilst in the queue': '5ffdc18a06653f3fce3dac53',
        'job created': '6081930d4be2b75352ccfffe',
        'job died whilst queueing': '608194db8ce611e702692399',
        'job died with error': '6001e992b1fc2820d22ee7f5',
        'job estimating': '6081932b1972f3f3f9dddfc7',
        'job finished with success': '5ff4dcd6b254b87cbf066b15',
        'job in the queue': '6081933d284fabc05c0342ba',
        'job running': '6082cb29d1d7027cac486f70',
    };

    const jobData = JSON.parse(JSON.stringify(JobsData.allJobs)).map((job) => {
        if (jobRemapping[job.job_id]) {
            job.job_id = jobRemapping[job.job_id];
        }
        return job;
    });

    // switch fake job IDs for real ones in narrative
    jobData.forEach((job) => {
        if (jobRemapping[job.job_id]) {
            job.job_id = jobRemapping[job.job_id];
        }
    });

    const runningJobs = [
        '6094754594a50504ee237ad3',
        '60947546a4bf5df208d5c6c0',
        '60947548750aebe52f08d03f',
        '609475496dfaa42013b5f618',
    ].map((job) => {
        return { status: 'running', created: 0, job_id: job };
    });

    TestAppObj.exec.jobs = Jobs.jobArrayToIndexedObject(jobData.concat(runningJobs));
    delete TestAppObj.exec.jobState;

    return {
        exec: TestAppObj.exec,
    };
});
