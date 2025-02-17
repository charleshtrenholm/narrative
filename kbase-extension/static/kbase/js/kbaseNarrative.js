/* global KBError, KBFatal */
/**
 * This is the entry point for the Narrative's front-end. It initializes
 * the login session, fires up the data and function widgets, and creates
 * the kbaseNarrativeWorkspace wrapper around the Jupyter notebook that
 * does fun things like manage widgets and cells and kernel events to talk to them.
 *
 * To set global variables, use: Jupyter.narrative.<name> = value
 */

define([
    'jquery',
    'bluebird',
    'handlebars',
    'narrativeConfig',
    'common/jobCommChannel',
    'kbaseNarrativeSidePanel',
    'kbaseNarrativeOutputCell',
    'kbaseNarrativeWorkspace',
    'kbaseNarrativeMethodCell',
    'kbaseAccordion',
    'kbaseNarrativeSharePanel',
    'widgets/narrative_core/staticNarrativesManager',
    'kbaseNarrativePrestart',
    'ipythonCellMenu',
    'base/js/namespace',
    'base/js/events',
    'base/js/keyboard',
    'notebook/js/notebook',
    'util/display',
    'util/bootstrapDialog',
    'util/timeFormat',
    'text!kbase/templates/update_dialog_body.html',
    'text!kbase/templates/document_version_change.html',
    'narrativeLogin',
    'common/ui',
    'common/html',
    'common/runtime',
    'narrativeTour',
    'kb_service/utils',
    'widgets/loadingWidget',
    'kb_service/client/workspace',
    'util/kbaseApiUtil',
    'bootstrap',
], (
    $,
    Promise,
    Handlebars,
    Config,
    JobComms,
    KBaseNarrativeSidePanel,
    KBaseNarrativeOutputCell,
    KBaseNarrativeWorkspace,
    KBaseNarrativeMethodCell,
    KBaseAccordion,
    KBaseNarrativeSharePanel,
    StaticNarrativesPanel,
    KBaseNarrativePrestart,
    KBaseCellToolbar,
    Jupyter,
    Events,
    Keyboard,
    Notebook,
    DisplayUtil,
    BootstrapDialog,
    TimeFormat,
    UpdateDialogBodyTemplate,
    DocumentVersionDialogBodyTemplate,
    NarrativeLogin,
    UI,
    html,
    Runtime,
    Tour,
    ServiceUtils,
    LoadingWidget,
    Workspace,
    APIUtil
) => {
    'use strict';

    KBaseNarrativePrestart.loadDomEvents();
    KBaseNarrativePrestart.loadGlobals();
    KBaseNarrativePrestart.loadJupyterEvents();

    /**
     * @constructor
     * The base, namespaced Narrative object. This is mainly used at start-up time, and
     * gets injected into the Jupyter namespace.
     *
     * Most of its methods below - init, registerEvents, initAboutDialog, initUpgradeDialog,
     * checkVersion, updateVersion - are set up at startup time.
     * This is all done by an injection into static/notebook/js/main.js where the
     * Narrative object is set up, and Narrative.init is run.
     *
     * But, this also has a noteable 'Save' method, that implements another Narrative-
     * specific piece of functionality. See Narrative.prototype.saveNarrative below.
     */
    const Narrative = function () {
        // Maximum narrative size that can be stored in the workspace.
        // This is set by nginx on the backend - this variable is just for
        // communication on error.
        this.maxNarrativeSize = '10 MB';

        // the controller is an instance of kbaseNarrativeWorkspace, which
        // controls widget management and KBase method execution
        this.narrController = null;

        this.sidePanel = null;

        // If true, this narrative is read only
        this.readonly = false;

        // The user's current session token.
        this.authToken = null;

        // How often to check for a new version in ms (not currently used)
        this.versionCheckTime = 6000 * 60 * 1000;

        this.versionHtml = 'KBase Narrative';

        // The currently selected Jupyter cell.
        this.selectedCell = null;

        // The version of the Narrative UI (semantic version)
        this.currentVersion = Config.get('version');

        // The version of the currently loaded Narrative document object.
        this.documentVersionInfo = [];
        this.stopVersionCheck = false;

        //
        this.dataViewers = null;

        // Used for mapping from user id -> user name without having to it
        // up again every time.
        this.cachedUserIds = {};

        this.runtime = Runtime.make();
        this.workspaceRef = null;
        this.workspaceId = this.runtime.workspaceId();
        this.workspaceInfo = {};
        this.sidePanel = null;

        // The set of currently instantiated KBase Widgets.
        // key = cell id, value = Widget object itself.
        this.kbaseWidgets = {};

        this.loadingWidget = new LoadingWidget({
            node: document.querySelector('#kb-loading-blocker'),
            timeout: 20000,
        });
        return this;
    };

    Narrative.prototype.isLoaded = () => {
        return Jupyter.notebook._fully_loaded;
    };

    Narrative.prototype.uiModeIs = function (testMode) {
        const uiMode = Jupyter.notebook.writable ? 'edit' : 'view';
        return testMode.toLowerCase() === uiMode;
    };

    Narrative.prototype.getAuthToken = function () {
        return NarrativeLogin.getAuthToken();
    };

    Narrative.prototype.getNarrativeRef = function () {
        return Promise.try(() => {
            if (this.workspaceRef) {
                return this.workspaceRef;
            }
            return new Workspace(Config.url('workspace'), {
                token: this.getAuthToken(),
            })
                .get_workspace_info({ id: this.workspaceId })
                .then((wsInfo) => {
                    const narrId = wsInfo[8]['narrative'];
                    this.workspaceRef = this.workspaceId + '/' + narrId;
                    return this.workspaceRef;
                });
        });
    };

    Narrative.prototype.getUserPermissions = function () {
        const ws = new Workspace(Config.url('workspace'), {
            token: this.getAuthToken(),
        });
        return ws.get_workspace_info({ id: this.workspaceId }).then((wsInfo) => {
            return wsInfo[5];
        });
    };

    // Wrappers for the Jupyter/Jupyter function so we only maintain it in one place.
    Narrative.prototype.patchKeyboardMapping = function () {
        const commonShortcuts = [
                'a',
                'm',
                'f',
                'y',
                'r',
                '1',
                '2',
                '3',
                '4',
                '5',
                '6',
                'k',
                'j',
                'b',
                'x',
                'c',
                'v',
                'z',
                'd,d',
                's',
                'l',
                'o',
                'h',
                'i,i',
                '0,0',
                'q',
                'shift-j',
                'shift-k',
                'shift-m',
                'shift-o',
                'shift-v',
            ],
            commandShortcuts = [],
            editShortcuts = [
                // remove the command palette
                // since it exposes commands we have 'disabled'
                // by removing keyboard mappings
                'cmdtrl-shift-p',
            ];

        commonShortcuts.forEach((shortcut) => {
            try {
                Jupyter.keyboard_manager.command_shortcuts.remove_shortcut(shortcut);
            } catch (e) {
                console.warn('Error removing shortcut "' + shortcut + '"', e);
            }
            try {
                Jupyter.notebook.keyboard_manager.edit_shortcuts.remove_shortcut(shortcut);
            } catch (e) {
                // console.warn('Error removing shortcut "' + shortcut + '"', e);
            }
        });

        commandShortcuts.forEach((shortcut) => {
            try {
                Jupyter.keyboard_manager.command_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                console.warn('Error removing shortcut "' + shortcut + '"', ex);
            }
        });

        editShortcuts.forEach((shortcut) => {
            try {
                Jupyter.notebook.keyboard_manager.edit_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                console.warn('Error removing shortcut "' + shortcut + '"', ex);
            }
        });
    };

    Narrative.prototype.disableKeyboardManager = function () {
        Jupyter.keyboard_manager.disable();
    };

    Narrative.prototype.enableKeyboardManager = function () {
        // Jupyter.keyboard_manager.enable();
    };

    /**
     * Registers Narrative responses to a few Jupyter events - mainly some
     * visual effects for managing when the cell toolbar should be shown,
     * and when saving is being done, but it also disables the keyboard
     * manager when KBase cells are selected.
     */
    Narrative.prototype.registerEvents = function () {
        const self = this;
        $([Jupyter.events]).on('before_save.Notebook', () => {
            $('#kb-save-btn').find('div.fa-save').addClass('fa-spin');
        });
        $([Jupyter.events]).on('notebook_saved.Notebook', () => {
            $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
            self.stopVersionCheck = false;
            self.updateDocumentVersion();
        });
        $([Jupyter.events]).on('kernel_idle.Kernel', () => {
            $('#kb-kernel-icon').removeClass().addClass('fa fa-circle-o');
        });
        $([Jupyter.events]).on('kernel_busy.Kernel', () => {
            $('#kb-kernel-icon').removeClass().addClass('fa fa-circle');
        });
        [
            'kernel_connected.Kernel',
            'kernel_starting.Kernel',
            'kernel_ready.Kernel',
            'kernel_disconnected.Kernel',
            'kernel_killed.Kernel',
            'kernel_dead.Kernel',
        ].forEach((e) => {
            $([Jupyter.events]).on(e, () => {
                self.runtime.bus().emit('kernel-state-changed', {
                    isReady: Jupyter.notebook.kernel && Jupyter.notebook.kernel.is_connected(),
                });
            });
        });

        $([Jupyter.events]).on('notebook_save_failed.Notebook', (event, data) => {
            $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
            this.saveFailed(event, data);
        });
    };

    /**
     * Initializes the sharing panel and sets up the events
     * that show and hide it.
     *
     * This is a hack and a half because Select2, Bootstrap,
     * and Safari are all hateful things. Here are the sequence of
     * events.
     * 1. Initialize the dialog object.
     * 2. When it gets invoked, show the dialog.
     * 3. On the FIRST time it gets shown, after it's done
     * being rendered (shown.bs.modal event), then build and
     * show the share panel widget. The select2 thing only wants
     * to appear and behave correctly after the page loads, and
     * after there's a visible DOM element for it to render in.
     */
    Narrative.prototype.initSharePanel = function () {
        const sharePanel = $(
                '<div style="text-align:center"><br><br><img src="' +
                    Config.get('loading_gif') +
                    '"></div>'
            ),
            shareDialog = new BootstrapDialog({
                title: 'Change Share Settings',
                body: sharePanel,
                closeButton: true,
            });
        let shareWidget = null;
        shareDialog.getElement().one('shown.bs.modal', () => {
            shareWidget = new KBaseNarrativeSharePanel(sharePanel.empty(), {
                ws_name_or_id: this.getWorkspaceName(),
            });
        });
        $('#kb-share-btn').click(() => {
            const narrName = Jupyter.notebook.notebook_name;
            if (narrName.trim().toLowerCase() === 'untitled' || narrName.trim().length === 0) {
                Jupyter.save_widget.rename_notebook({
                    notebook: Jupyter.notebook,
                    message: 'Please name your Narrative before sharing.',
                    callback: function () {
                        shareDialog.show();
                    },
                });
                return;
            }
            if (shareWidget) {
                shareWidget.refresh();
            }
            shareDialog.show();
        });
    };

    Narrative.prototype.initStaticNarrativesPanel = function () {
        if (!Config.get('features').staticNarratives) {
            $('#kb-static-btn').remove();
            return;
        }
        const staticPanel = $('<div>'),
            staticDialog = new BootstrapDialog({
                title: 'Static Narratives',
                body: staticPanel,
                closeButton: true,
            }),
            staticWidget = new StaticNarrativesPanel(staticPanel);
        $('#kb-static-btn').click(() => {
            staticWidget.refresh();
            staticDialog.show();
        });
    };

    /**
     * Expects docInfo to be a workspace object info array, especially where the 4th element is
     * an int > 0.
     */
    Narrative.prototype.checkDocumentVersion = function (docInfo) {
        if (docInfo.length < 5 || this.stopVersionCheck) {
            return;
        }
        if (docInfo[4] !== this.documentVersionInfo[4]) {
            // now we make the dialog and all that.
            $('#kb-narr-version-btn')
                .off('click')
                .on('click', () => {
                    this.showDocumentVersionDialog(docInfo);
                });
            this.toggleDocumentVersionBtn(true);
        }
    };

    /**
     * Expects the usual workspace object info array. If that's present, it's captured. If not,
     * we run get_object_info_new and fetch it ourselves. Note that it should have its metadata.
     */
    Narrative.prototype.updateDocumentVersion = function (docInfo) {
        const self = this;
        return Promise.try(() => {
            if (docInfo) {
                self.documentVersionInfo = docInfo;
            } else {
                const workspace = new Workspace(Config.url('workspace'), {
                    token: self.getAuthToken(),
                });
                self.getNarrativeRef()
                    .then((narrativeRef) => {
                        return workspace.get_object_info_new({
                            objects: [{ ref: narrativeRef }],
                            includeMetadata: 1,
                        });
                    })
                    .then((info) => {
                        self.documentVersionInfo = info[0];
                    })
                    .catch((error) => {
                        // no op for now.
                        console.error(error);
                    });
            }
        });
    };

    Narrative.prototype.showDocumentVersionDialog = function (newVerInfo) {
        const bodyTemplate = Handlebars.compile(DocumentVersionDialogBodyTemplate);

        const versionDialog = new BootstrapDialog({
            title: 'Showing an older Narrative document',
            body: bodyTemplate({
                currentVer: this.documentVersionInfo,
                currentDate: TimeFormat.readableTimestamp(this.documentVersionInfo[3]),
                newVer: newVerInfo,
                newDate: TimeFormat.readableTimestamp(newVerInfo[3]),
                sameUser: this.documentVersionInfo[5] === newVerInfo[5],
                readOnly: this.readonly,
            }),
            alertOnly: true,
        });

        versionDialog.show();
    };

    /**
     * @method
     * @public
     * This shows or hides the 'narrative has been saved in a different window' button.
     * If show is truthy, show it. Otherwise, hide it.
     */
    Narrative.prototype.toggleDocumentVersionBtn = function (show) {
        const $btn = $('#kb-narr-version-btn');
        if (show && !$btn.is(':visible')) {
            $btn.fadeIn('fast');
        } else if (!show && $btn.is(':visible')) {
            $btn.fadeOut('fast');
        }
    };

    /**
     * The "Upgrade your container" dialog should be made available when
     * there's a more recent version of the Narrative ready to use. This
     * dialog then lets the user shut down their existing Narrative container.
     */
    Narrative.prototype.initUpgradeDialog = function () {
        const bodyTemplate = Handlebars.compile(UpdateDialogBodyTemplate);

        const $cancelBtn = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-default')
            .append('Cancel');
        const $upgradeBtn = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-success')
            .append('Update and Reload')
            .click(() => {
                this.updateVersion();
            });

        const upgradeDialog = new BootstrapDialog({
            title: 'New Narrative version available!',
            buttons: [$cancelBtn, $upgradeBtn],
        });
        $('#kb-update-btn').click(() => {
            upgradeDialog.show();
        });
        this.checkVersion().then((ver) => {
            upgradeDialog.setBody(
                bodyTemplate({
                    currentVersion: this.currentVersion,
                    newVersion: ver ? ver.version : 'No new version',
                    releaseNotesUrl: Config.get('release_notes'),
                })
            );
            if (ver && ver.version && this.currentVersion !== ver.version) {
                $('#kb-update-btn').fadeIn('fast');
            }
        });
    };

    /**
     * Looks up what is the current version of the Narrative.
     * This should eventually get rolled into a Narrative Service method call.
     */
    Narrative.prototype.checkVersion = function () {
        // look up new version here.
        return Promise.resolve(
            $.ajax({
                url: Config.url('version_check'),
                async: true,
                dataType: 'text',
                crossDomain: true,
                cache: false,
            })
        )
            .then((ver) => {
                return Promise.try(() => {
                    ver = $.parseJSON(ver);
                    return ver;
                });
            })
            .catch((error) => {
                console.error('Error while checking for a version update: ' + error.statusText);
                KBError('Narrative.checkVersion', 'Unable to check for a version update!');
            });
    };

    Narrative.prototype.createShutdownDialogButtons = function () {
        const $shutdownButton = $('<button>')
            .attr({ type: 'button', 'data-dismiss': 'modal' })
            .addClass('btn btn-danger')
            .append('Okay. Shut it all down!')
            .click(() => {
                this.updateVersion();
            });

        const $reallyShutdownPanel = $('<div style="margin-top:10px">')
            .append(
                'This will shutdown your Narrative session and close this window.<br><b>Any unsaved data in any open Narrative in any window WILL BE LOST!</b><br>'
            )
            .append($shutdownButton)
            .hide();

        const $firstShutdownBtn = $('<button>')
            .attr({ type: 'button' })
            .addClass('btn btn-danger')
            .append('Shutdown')
            .click(() => {
                $reallyShutdownPanel.slideDown('fast');
            });

        const $cancelButton = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-default')
            .append('Dismiss')
            .click(() => {
                $reallyShutdownPanel.hide();
            });

        return {
            cancelButton: $cancelButton,
            firstShutdownButton: $firstShutdownBtn,
            finalShutdownButton: $shutdownButton,
            shutdownPanel: $reallyShutdownPanel,
        };
    };

    Narrative.prototype.initAboutDialog = function () {
        const $versionDiv = $('<div>').append('<b>Version:</b> ' + Config.get('version'));
        $versionDiv.append(
            '<br><b>Git Commit:</b> ' +
                Config.get('git_commit_hash') +
                ' -- ' +
                Config.get('git_commit_time')
        );
        $versionDiv.append(
            '<br>View release notes on <a href="' +
                Config.get('release_notes') +
                '" target="_blank">Github</a>'
        );

        const urlList = Object.keys(Config.get('urls')).sort();
        const $versionTable = $('<table>').addClass('table table-striped table-bordered');
        $.each(urlList, (idx, val) => {
            let url = Config.url(val);
            // if url looks like a url (starts with http), include it.
            // ignore job proxy and submit ticket
            if (
                val === 'narrative_job_proxy' ||
                val === 'submit_jira_ticket' ||
                val === 'narrative_method_store_types' ||
                url === null
            ) {
                return;
            }
            url = url.toString();
            if (url && url.toLowerCase().indexOf('http') === 0) {
                $versionTable.append(
                    $('<tr>').append($('<td>').append(val)).append($('<td>').append(url))
                );
            }
        });
        const $verAccordionDiv = $('<div style="margin-top:15px">');
        $versionDiv.append($verAccordionDiv);

        new KBaseAccordion($verAccordionDiv, {
            elements: [
                {
                    title: 'KBase Service URLs',
                    body: $versionTable,
                },
            ],
        });

        const shutdownButtons = this.createShutdownDialogButtons();
        const aboutDialog = new BootstrapDialog({
            title: 'KBase Narrative Properties',
            body: $versionDiv,
            buttons: [
                shutdownButtons.cancelButton,
                shutdownButtons.firstShutdownButton,
                shutdownButtons.shutdownPanel,
            ],
        });

        $('#kb-about-btn').click(() => {
            aboutDialog.show();
        });
    };

    Narrative.prototype.initShutdownDialog = function () {
        const shutdownButtons = this.createShutdownDialogButtons();

        const shutdownDialog = new BootstrapDialog({
            title: 'Shutdown and restart narrative?',
            body: $('<div>').append(
                'Shutdown and restart your Narrative session? Any unsaved changes in any open Narrative in any window WILL BE LOST!'
            ),
            buttons: [shutdownButtons.cancelButton, shutdownButtons.finalShutdownButton],
        });

        $('#kb-shutdown-btn').click(() => {
            shutdownDialog.show();
        });
    };

    Narrative.prototype.saveFailed = function (event, data) {
        $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
        Jupyter.save_widget.set_save_status('Narrative save failed!');

        let errorText;
        // 413 means that the Narrative is too large to be saved.
        // currently - 4/6/2015 - there's a hard limit of 4MB per KBase Narrative.
        // Any larger object will throw a 413 error, and we need to show some text.
        if (data.xhr.status === 413) {
            errorText =
                'Due to current system constraints, a Narrative may not exceed ' +
                this.maxNarrativeSize +
                ' of text.<br><br>' +
                'Errors of this sort are usually due to excessive size ' +
                'of outputs from Code Cells, or from large objects ' +
                'embedded in Markdown Cells.<br><br>' +
                'Please decrease the document size and try to save again.';
        } else if (data.xhr.responseText) {
            const $error = $($.parseHTML(data.xhr.responseText));
            errorText = $error.find('#error-message > h3').text();

            if (errorText) {
                /* gonna throw in a special case for workspace permissions issues for now.
                 * if it has this pattern:
                 *
                 * User \w+ may not write to workspace \d+
                 * change the text to something more sensible.
                 */

                const res = /User\s+(\w+)\s+may\s+not\s+write\s+to\s+workspace\s+(\d+)/.exec(
                    errorText
                );
                if (res) {
                    errorText =
                        'User ' +
                        res[1] +
                        ' does not have permission to save to workspace ' +
                        res[2] +
                        '.';
                }
            }
        } else {
            errorText = 'An unknown error occurred!';
        }

        Jupyter.dialog.modal({
            title: 'Narrative save failed!',
            body: $('<div>').append(errorText),
            buttons: {
                OK: {
                    class: 'btn-primary',
                    click: function () {
                        return;
                    },
                },
            },
            open: function () {
                const that = $(this);
                // Upon ENTER, click the OK button.
                that.find('input[type="text"]').keydown((_event) => {
                    if (_event.which === Keyboard.keycodes.enter) {
                        that.find('.btn-primary').first().click();
                    }
                });
                that.find('input[type="text"]').focus();
            },
        });
    };

    Narrative.prototype.initTour = function () {
        try {
            $('#kb-tour').click(() => {
                const tour = new Tour.Tour(this);
                tour.start();
            });
        } catch (e) {
            console.error(e);
        }
    };

    /**
     * This is the Narrative front end initializer. It should only be run directly after
     * the app_initialized.NotebookApp event has been fired.
     *
     * It does the following steps:
     * 1. Registers event listeners on Jupyter events such as cell selection, insertion,
     *    deletion, etc.
     * 2. Initializes the Core UI dialogs that depend on configuration information (About,
     *    Upgrade, and Shutdown).
     * 3. Initializes the help tour.
     *
     * The rest depends on a few Jupyter events being fired. Once the notebook is registered
     * as "loaded" (notebook_loaded.Notebook), we can proceed to load the data, apps, and
     * side panel components.
     *
     * When the kernel is connected (the channel between front and back ends, with the
     * kernel_connected.Kernel event), we can set up the job communication channel.
     *
     * Since these are handled by jquery events, we need an optional callback. The
     * jobsReadyCallback function is invoked after setting up (or failing to set up) the
     * job communication channel with the kernel. It takes an (optional) error object as
     * input, which will have structure { error: xxx }, where xxx is the structure of the error
     * that might get thrown by the Jupyter stack.
     *
     */
    Narrative.prototype.init = function (jobsReadyCallback) {
        // NAR-271 - Firefox needs to be told where the top of the page is. :P
        window.scrollTo(0, 0);

        this.authToken = NarrativeLogin.getAuthToken();
        this.userId = NarrativeLogin.sessionInfo.user;

        this.patchKeyboardMapping();
        this.registerEvents();
        this.initAboutDialog();
        this.initUpgradeDialog();
        this.initShutdownDialog();
        this.initTour();

        /* Clever extension to $.event from StackOverflow
         * Lets us watch DOM nodes and catch when a widget's node gets nuked.
         * http://stackoverflow.com/questions/2200494/jquery-trigger-event-when-an-element-is-removed-from-the-dom
         *
         * We bind a jQuery event to a node. Call it 'destroyed'.
         * When that event is no longer bound (i.e. when the node is removed, OR when .unbind is called)
         * it triggers the 'remove' function. Lets us keep track of when widgets get removed
         * in the registerWidget function below.
         */
        $.event.special.destroyed = {
            remove: function (o) {
                if (o.handler) {
                    o.handler();
                }
            },
        };

        $([Jupyter.events]).on('notebook_loaded.Notebook', () => {
            this.loadingWidget.updateProgress('narrative', true);
            $('#notification_area').find('div#notification_trusted').hide();

            $(document).one('dataUpdated.Narrative', () =>
                this.loadingWidget.updateProgress('data', true)
            );

            $(document).one('appListUpdated.Narrative', () =>
                this.loadingWidget.updateProgress('apps', true)
            );

            // Tricky with inter/intra-dependencies between kbaseNarrative and kbaseNarrativeWorkspace...
            this.sidePanel = new KBaseNarrativeSidePanel($('#kb-side-panel'), {
                autorender: false,
            });
            this.narrController = new KBaseNarrativeWorkspace($('#notebook_panel'));

            // Disable autosave so as not to spam the Workspace.
            Jupyter.notebook.set_autosave_interval(0);
            KBaseCellToolbar.register(Jupyter.notebook);
            Jupyter.CellToolbar.activate_preset('KBase');
            Jupyter.CellToolbar.global_show();

            if (Jupyter.notebook && Jupyter.notebook.metadata) {
                const creatorId = Jupyter.notebook.metadata.creator || 'KBase User';
                DisplayUtil.displayRealName(creatorId, $('#kb-narr-creator'));

                // This puts the cell menu in the right place.
                $([Jupyter.events]).trigger('select.Cell', {
                    cell: Jupyter.notebook.get_selected_cell(),
                });
            }
            if (this.getWorkspaceName() === null) {
                KBFatal(
                    'Narrative.init',
                    'Unable to locate workspace name from the Narrative object!'
                );
                this.loadingWidget.remove();
                return;
            }
            this.initSharePanel();
            this.initStaticNarrativesPanel();
            this.updateDocumentVersion().finally(() => this.sidePanel.render());
        });
        $([Jupyter.events]).on('kernel_connected.Kernel', () => {
            this.loadingWidget.updateProgress('kernel', true);
            this.jobCommChannel = new JobComms.JobCommChannel();
            this.jobCommChannel
                .initCommChannel()
                .then(() => {
                    this.loadingWidget.updateProgress('jobs', true);
                    if (jobsReadyCallback) {
                        jobsReadyCallback();
                    }
                })
                .catch((err) => {
                    console.error('An error occurred while initializing kbase comm channel', err);
                    KBFatal(
                        'Narrative.init',
                        'KBase communication channel could not be initiated with the kernel.'
                    );
                    if (jobsReadyCallback) {
                        jobsReadyCallback({ error: err });
                    }
                });
        });
    };

    /**
     * @method
     * @public
     * This manually deletes the Docker container that this Narrative runs in, if there is one.
     * If it can't, or if this is being run locally, it pops up an alert saying so.
     */
    Narrative.prototype.updateVersion = function () {
        const user = NarrativeLogin.sessionInfo.user;
        Promise.resolve(
            $.ajax({
                contentType: 'application/json',
                url: '/narrative_shutdown/' + user,
                type: 'DELETE',
                crossDomain: true,
            })
        )
            .then(() => {
                setTimeout(() => {
                    location.replace(`/load-narrative.html?n=${this.workspaceId}&check=true`);
                }, 200);
            })
            .catch((error) => {
                window.alert(
                    'Unable to update your Narrative session\nError: ' +
                        error.status +
                        ': ' +
                        error.statusText
                );
                console.error(error);
            });
    };

    /**
     * @method
     * @public
     * This triggers a save, but saves all cell states first.
     */
    Narrative.prototype.saveNarrative = function () {
        this.stopVersionCheck = true;
        Jupyter.notebook.save_checkpoint();
        this.toggleDocumentVersionBtn(false);
    };

    /**
     * @method
     * @public
     * Insert a new App cell into a narrative and pre-populate its parameters with a given set of
     * values. The cell is inserted below the currently selected cell.
     * @param {string} appId - The id of the app (should be in form module_name/app_name)
     * @param {string} tag - The release tag of the app (one of release, beta, dev)
     * @param {object} parameters - Key-value-pairs describing the parameters to initialize the app
     * with. Keys are param ids (should match the spec), and values are the values of those
     * parameters.
     */
    Narrative.prototype.addAndPopulateApp = function (appId, tag, parameters) {
        this.sidePanel.$methodsWidget.triggerApp(appId, tag, parameters);
    };

    /**
     * @method
     * @public
     * Insert a new Viewer cell into a narrative for a given object. The new cell is inserted below
     * the currently selected cell.
     * @param {string|object|array} obj - If a string, expected to be an object reference. If an object,
     * expected to be a set of Key-value-pairs describing the object. If an array, expected to be
     * the usual workspace info array for an object.
     */
    Narrative.prototype.addViewerCell = function (obj) {
        if (Jupyter.narrative.readonly) {
            new BootstrapDialog({
                type: 'warning',
                title: 'Warning',
                body: 'Read-only Narrative -- may not add a data viewer to this Narrative',
                alertOnly: true,
            }).show();
            return;
        }
        const cell = Jupyter.notebook.get_selected_cell(),
            nearIdx = cell ? Jupyter.notebook.find_cell_index(cell) : 0;

        let objInfo = {};
        // If a string, expect a ref, and fetch the info.
        if (typeof obj === 'string') {
            objInfo = this.sidePanel.$dataWidget.getDataObjectByRef(obj, true);
        }
        // If an array, expect it to be an array of the info, and convert it.
        else if (Array.isArray(obj)) {
            objInfo = ServiceUtils.objectInfoToObject(obj);
        }
        // If not an array or a string, it's our object already.
        else {
            objInfo = obj;
        }
        this.narrController.trigger('createViewerCell.Narrative', {
            nearCellIdx: nearIdx,
            widget: 'kbaseNarrativeDataCell',
            info: objInfo,
        });
    };

    /**
     * @method
     * @public
     * Insert a new method into the narrative, set it as active, populate the
     * parameters, and run it.  This is useful for widgets that need to trigger
     * some additional narrative action, such as creating a FeatureSet from
     * a selected set of Features in a widget, or computing a statistic on a
     * subselection made from within a widget.
     */
    Narrative.prototype.createAndRunMethod = function (method_id, parameters) {
        //first make a request to get the method spec of a particular method
        //getFunctionSpecs.Narrative is implemented in kbaseNarrativeAppPanel
        const request = { methods: [method_id] };
        const self = this;
        self.narrController.trigger('getFunctionSpecs.Narrative', [
            request,
            function (specs) {
                // do nothing if the method could not be found
                const errorMsg = 'Method ' + method_id + ' not found and cannot run.';
                if (!specs) {
                    console.error(errorMsg);
                    return;
                }
                if (!specs.methods) {
                    console.error(errorMsg);
                    return;
                }
                if (!specs.methods[method_id]) {
                    console.error(errorMsg);
                    return;
                }
                // put the method in the narrative by simulating a method clicked in kbaseNarrativeAppPanel
                self.narrController.trigger('methodClicked.Narrative', specs.methods[method_id]);

                // the method initializes an internal method input widget, but rendering and initializing is
                // async, so we have to wait and check back before we can load the parameter state.
                // TODO: update kbaseNarrativeMethodCell to return a promise to mark when rendering is complete
                const newCell = Jupyter.notebook.get_selected_cell();
                const newCellIdx = Jupyter.notebook.get_selected_index();
                const newWidget = new KBaseNarrativeMethodCell(
                    $('#' + $(newCell.get_text())[0].id)
                );
                const updateStateAndRun = function () {
                    if (newWidget.$inputWidget) {
                        // if the $inputWidget is not null, we are good to go, so set the parameters
                        newWidget.loadState(parameters);
                        // make sure the new cell is still selected, then run the method
                        Jupyter.notebook.select(newCellIdx);
                        newWidget.runMethod();
                    } else {
                        // not ready yet, keep waiting
                        window.setTimeout(updateStateAndRun, 500);
                    }
                };
                // call the update and run after a short deplay
                window.setTimeout(updateStateAndRun, 50);
            },
        ]);
    };

    Narrative.prototype.getWorkspaceName = function () {
        return Jupyter.notebook.metadata.ws_name || null;
    };

    Narrative.prototype.lookupUserProfile = function (username) {
        return DisplayUtil.lookupUserProfile(username);
    };

    /**
     * A little bit of a riff on the Jupyter 'find_cell_index'.
     * Every KBase-ified cell (App, Method, Output) has a unique identifier.
     * This can be used to find the closest cell element - its index is the
     * Jupyter cell index (inferred somewhat from find_cell_index which calls
     * get_cell_elements, which does this searching).
     */
    Narrative.prototype.getCellIndexByKbaseId = function (id) {
        if (!Jupyter.notebook) {
            return null;
        }
        const cells = Jupyter.notebook.get_cells();
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            if (
                c.metadata.kbase &&
                c.metadata.kbase.attributes &&
                c.metadata.kbase.attributes.id &&
                c.metadata.kbase.attributes.id === id
            ) {
                return i;
            }
        }
        return null;
    };

    Narrative.prototype.getCellByKbaseId = function (id) {
        const cellIndex = this.getCellIndexByKbaseId(id);
        if (cellIndex !== null) {
            return Jupyter.notebook.get_cell(this.getCellIndexByKbaseId(id));
        }
        return null;
    };

    /**
     * Jupyter doesn't auto select cells on creation, so this
     * is a helper that does so. It then returns the cell object
     * that gets created.
     */
    Narrative.prototype.insertAndSelectCellBelow = function (cellType, index, data) {
        return this.insertAndSelectCell(cellType, 'below', index, data);
    };

    Narrative.prototype.insertAndSelectCellAbove = function (cellType, index, data) {
        return this.insertAndSelectCell(cellType, 'above', index, data);
    };

    Narrative.prototype.insertAndSelectCell = function (cellType, direction, index, data) {
        let newCell;
        if (direction === 'below') {
            newCell = Jupyter.notebook.insert_cell_below(cellType, index, data);
        } else {
            newCell = Jupyter.notebook.insert_cell_above(cellType, index, data);
        }
        Jupyter.notebook.focus_cell(newCell);
        Jupyter.notebook.select(Jupyter.notebook.find_cell_index(newCell));
        this.scrollToCell(newCell);

        return newCell;
    };

    Narrative.prototype.scrollToCell = function (cell, select) {
        const $elem = $('#notebook-container');
        $elem.animate(
            {
                scrollTop: cell.element.offset().top + $elem.scrollTop() - $elem.offset().top,
            },
            400
        );
        if (select) {
            Jupyter.notebook.focus_cell(cell);
            Jupyter.notebook.select(Jupyter.notebook.find_cell_index(cell));
        }
    };

    /**
     * if setHidden === true, then always hide
     * if setHidden === false (not null or undefined), then always show
     * if the setHidden variable isn't present, then just toggle
     */
    Narrative.prototype.toggleSidePanel = function (setHidden) {
        const delay = 'fast';
        let hidePanel = setHidden;
        if (hidePanel === null || hidePanel === undefined) {
            hidePanel = $('#left-column').is(':visible') ? true : false;
        }
        if (hidePanel) {
            $('#left-column').trigger('hideSidePanelOverlay.Narrative');
            $('#left-column').hide(
                'slide',
                {
                    direction: 'left',
                    easing: 'swing',
                    complete: function () {
                        $('#kb-side-toggle-in').show(0);
                    },
                },
                delay
            );
            // Move content flush left-ish
            $('#notebook-container').animate(
                { left: 0 },
                {
                    easing: 'swing',
                    duration: delay,
                }
            );
            $('#content-column')[0].classList.add('kb-content-column--expanded');
        } else {
            $('#kb-side-toggle-in').hide(0, () => {
                $('#left-column').show(
                    'slide',
                    {
                        direction: 'left',
                        easing: 'swing',
                    },
                    delay
                );
                $('#notebook-container').animate(
                    { left: 380 },
                    { easing: 'swing', duration: delay }
                );
            });
            $('#content-column')[0].classList.remove('kb-content-column--expanded');
        }
    };

    Narrative.prototype.showDataOverlay = function () {
        $(document).trigger(
            'showSidePanelOverlay.Narrative',
            this.sidePanel.$dataWidget.$overlayPanel
        );
    };

    Narrative.prototype.hideOverlay = function () {
        $(document).trigger('hideSidePanelOverlay.Narrative');
    };

    /**
     * Registers a KBase widget with the Narrative controller. This lets the
     * controller iterate over the widgets it knows about, so it can do group
     * operations on them.
     */
    Narrative.prototype.registerWidget = function (widget, cellId) {
        this.kbaseWidgets[cellId] = widget;
        $('#' + cellId).bind('destroyed', () => {
            this.removeWidget(cellId);
        });
    };

    Narrative.prototype.removeWidget = function (cellId) {
        delete this.kbaseWidgets[cellId];
    };

    /**
     * This inserts a new bulk import cell below the currently selected cell.
     * Its input is a map from object type to a the files to be uploaded and the app
     * used to process them.
     * {
     *   fileType: {
     *     appId: string,
     *     files: array of files,
     *     outputSuffix: string, a suggested suffix for the automated output names
     *   }
     * }
     * This returns a Promise that resolves into the cell that was created.
     * @param {object} bulkInput keys = type ids, values = an object with properties
     *  - appId - the app id to use for that file type (to be used in fetching the spec)
     *  - files - array of files to import with that file type
     */
    Narrative.prototype.insertBulkImportCell = function (bulkInput) {
        const cellType = 'app-bulk-import';
        const cellData = {
            type: cellType,
            typesToFiles: bulkInput ? bulkInput : {},
        };
        // get a unique array of app ids we need to look up
        const appIds = [...new Set(Object.values(bulkInput).map((typeInfo) => typeInfo.appId))];
        return APIUtil.getAppSpecs(appIds).then((appSpecs) => {
            cellData.specs = appSpecs.reduce((allSpecs, spec) => {
                allSpecs[spec.info.id] = spec;
                return allSpecs;
            }, {});
            return this.insertAndSelectCellBelow('code', null, cellData);
        });
    };

    return Narrative;
});
