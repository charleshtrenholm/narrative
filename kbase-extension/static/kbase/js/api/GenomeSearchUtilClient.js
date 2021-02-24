/* warning: this generated client has a small hack to cache the search service
url returned by the serviceWizard - we need to do this in the SDK templates */

function GenomeSearchUtil(url, auth, auth_cb, timeout, async_job_check_time_ms, service_version, use_url_lookup) {
    const self = this;

    this.url = url;
    let _url = url;

    this.timeout = timeout;
    const _timeout = timeout;
    
    this.async_job_check_time_ms = async_job_check_time_ms;
    if (!this.async_job_check_time_ms)
        this.async_job_check_time_ms = 100;
    this.async_job_check_time_scale_percent = 150;
    this.async_job_check_max_time_ms = 300000;  // 5 minutes
    this.service_version = service_version;
    if (!this.service_version)
        this.service_version = 'release';
    this.use_url_lookup = true;
    if(typeof use_url_lookup !== 'undefined') {
        this.use_url_lookup = use_url_lookup;
    }

    if (typeof(_url) != "string" || _url.length == 0) {
        _url = "https://kbase.us/services/service_wizard";
    }
    const _auth = auth ? auth : { 'token' : '', 'user_id' : ''};
    const _auth_cb = auth_cb;

     this.search = function (params, _callback, _errorCallback) {
        if (typeof params === 'function')
            throw 'Argument params can not be a function';
        if (_callback && typeof _callback !== 'function')
            throw 'Argument _callback must be a function if defined';
        if (_errorCallback && typeof _errorCallback !== 'function')
            throw 'Argument _errorCallback must be a function if defined';
        if (typeof arguments === 'function' && arguments.length > 1+2)
            throw 'Too many arguments ('+arguments.length+' instead of '+(1+2)+')';
        const deferred = $.Deferred();
        if(this.use_url_lookup) {
            json_call_ajax(_url, 'ServiceWizard.get_service_status', [{'module_name' : "GenomeSearchUtil", 
                    'version' : self.service_version}], 1, (service_status_ret) => {
                srv_url = service_status_ret['url'];
                json_call_ajax(srv_url, "GenomeSearchUtil.search", 
                    [params], 1, _callback, _errorCallback, null, deferred);
            }, (err) => {
                if (_errorCallback) {
                    _errorCallback(err);
                } else {
                    deferred.reject({
                        status: 500,
                        error: err
                    });
                }
            });
        } else {
            json_call_ajax(_url, "GenomeSearchUtil.search", 
                    [params], 1, _callback, _errorCallback, null, deferred);
        }
        return deferred;
    };

    this.search_region = function (params, _callback, _errorCallback) {
        if (typeof params === 'function')
            throw 'Argument params can not be a function';
        if (_callback && typeof _callback !== 'function')
            throw 'Argument _callback must be a function if defined';
        if (_errorCallback && typeof _errorCallback !== 'function')
            throw 'Argument _errorCallback must be a function if defined';
        if (typeof arguments === 'function' && arguments.length > 1+2)
            throw 'Too many arguments ('+arguments.length+' instead of '+(1+2)+')';
        const deferred = $.Deferred();
        if(this.use_url_lookup) {
            json_call_ajax(_url, 'ServiceWizard.get_service_status', [{'module_name' : "GenomeSearchUtil", 
                    'version' : self.service_version}], 1, (service_status_ret) => {
                srv_url = service_status_ret['url'];
                json_call_ajax(srv_url, "GenomeSearchUtil.search_region", 
                    [params], 1, _callback, _errorCallback, null, deferred);
            }, (err) => {
                if (_errorCallback) {
                    _errorCallback(err);
                } else {
                    deferred.reject({
                        status: 500,
                        error: err
                    });
                }
            });
        } else {
            json_call_ajax(_url, "GenomeSearchUtil.search_region", 
                    [params], 1, _callback, _errorCallback, null, deferred);
        }
        return deferred;
    };
  
    this.search_contigs = function (params, _callback, _errorCallback) {
        if (typeof params === 'function')
            throw 'Argument params can not be a function';
        if (_callback && typeof _callback !== 'function')
            throw 'Argument _callback must be a function if defined';
        if (_errorCallback && typeof _errorCallback !== 'function')
            throw 'Argument _errorCallback must be a function if defined';
        if (typeof arguments === 'function' && arguments.length > 1+2)
            throw 'Too many arguments ('+arguments.length+' instead of '+(1+2)+')';
        const deferred = $.Deferred();
        if(this.use_url_lookup) {
            json_call_ajax(_url, 'ServiceWizard.get_service_status', [{'module_name' : "GenomeSearchUtil", 
                    'version' : self.service_version}], 1, (service_status_ret) => {
                srv_url = service_status_ret['url'];
                json_call_ajax(srv_url, "GenomeSearchUtil.search_contigs", 
                    [params], 1, _callback, _errorCallback, null, deferred);
            }, (err) => {
                if (_errorCallback) {
                    _errorCallback(err);
                } else {
                    deferred.reject({
                        status: 500,
                        error: err
                    });
                }
            });
        } else {
            json_call_ajax(_url, "GenomeSearchUtil.search_contigs", 
                    [params], 1, _callback, _errorCallback, null, deferred);
        }
        return deferred;
    };

    this.status = function (_callback, _errorCallback) {
        if (_callback && typeof _callback !== 'function')
            throw 'Argument _callback must be a function if defined';
        if (_errorCallback && typeof _errorCallback !== 'function')
            throw 'Argument _errorCallback must be a function if defined';
        if (typeof arguments === 'function' && arguments.length > 2)
            throw 'Too many arguments ('+arguments.length+' instead of 2)';
        const deferred = $.Deferred();
        json_call_ajax(_url, 'ServiceWizard.get_service_status', [{'module_name' : "GenomeSearchUtil", 
                'version' : self.service_version}], 1, (service_status_ret) => {
            srv_url = service_status_ret['url'];
            json_call_ajax(srv_url, "GenomeSearchUtil.status", 
                [], 1, _callback, _errorCallback, null, deferred);
        }, (err) => {
            if (_errorCallback) {
                _errorCallback(err);
            } else {
                deferred.reject({
                    status: 500,
                    error: err
                });
            }
        });
        return deferred;
    };


    /*
     * JSON call using jQuery method.
     */
    function json_call_ajax(srv_url, method, params, numRets, callback, errorCallback, json_rpc_context, deferred) {
        if (!deferred)
            deferred = $.Deferred();

        if (typeof callback === 'function') {
           deferred.done(callback);
        }

        if (typeof errorCallback === 'function') {
           deferred.fail(errorCallback);
        }

        const rpc = {
            params : params,
            method : method,
            version: "1.1",
            id: String(Math.random()).slice(2),
        };
        if (json_rpc_context)
            rpc['context'] = json_rpc_context;

        let beforeSend = null;
        const token = (_auth_cb && typeof _auth_cb === 'function') ? _auth_cb()
            : (_auth.token ? _auth.token : null);
        if (token != null) {
            beforeSend = function (xhr) {
                xhr.setRequestHeader("Authorization", token);
            }
        }

        const xhr = jQuery.ajax({
            url: srv_url,
            dataType: "text",
            type: 'POST',
            processData: false,
            data: JSON.stringify(rpc),
            beforeSend: beforeSend,
            timeout: _timeout,
            success: function (data, status, xhr) {
                let result;
                try {
                    const resp = JSON.parse(data);
                    result = (numRets === 1 ? resp.result[0] : resp.result);
                } catch (err) {
                    deferred.reject({
                        status: 503,
                        error: err,
                        url: srv_url,
                        resp: data
                    });
                    return;
                }
                deferred.resolve(result);
            },
            error: function (xhr, textStatus, errorThrown) {
                let error;
                if (xhr.responseText) {
                    try {
                        const resp = JSON.parse(xhr.responseText);
                        error = resp.error;
                    } catch (err) { // Not JSON
                        error = "Unknown error - " + xhr.responseText;
                    }
                } else {
                    error = "Unknown Error";
                }
                deferred.reject({
                    status: 500,
                    error: error
                });
            }
        });

        const promise = deferred.promise();
        promise.xhr = xhr;
        return promise;
    }
}


 