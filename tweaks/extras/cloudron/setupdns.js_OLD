'use strict';

/* global $, tld, angular, Clipboard */

// create main application module
var app = angular.module('Application', ['pascalprecht.translate', 'ngCookies', 'angular-md5', 'ui-notification', 'ui.bootstrap']);

app.filter('zoneName', function () {
    return function (domain) {
        return tld.getDomain(domain);
    };
});

app.controller('SetupDNSController', ['$scope', '$http', '$timeout', 'Client', function ($scope, $http, $timeout, Client) {
    var search = decodeURIComponent(window.location.search).slice(1).split('&').map(function (item) { return item.split('='); }).reduce(function (o, k) { o[k[0]] = k[1]; return o; }, {});

    $scope.state = null; // 'initialized', 'waitingForDnsSetup', 'waitingForBox'
    $scope.error = {};
    $scope.provider = '';
    $scope.showDNSSetup = false;
    $scope.instanceId = '';
    $scope.isDomain = false;
    $scope.isSubdomain = false;
    $scope.advancedVisible = false;
    $scope.webServerOrigin = '';
    $scope.clipboardDone = false;
    $scope.search = window.location.search;
    $scope.setupToken = '';

    $scope.tlsProvider = [
        { name: 'Let\'s Encrypt Prod', value: 'letsencrypt-prod' },
        { name: 'Let\'s Encrypt Prod - Wildcard', value: 'letsencrypt-prod-wildcard' },
        { name: 'Let\'s Encrypt Staging', value: 'letsencrypt-staging' },
        { name: 'Let\'s Encrypt Staging - Wildcard', value: 'letsencrypt-staging-wildcard' },
        { name: 'Self-Signed', value: 'fallback' }, // this is not 'Custom' because we don't allow user to upload certs during setup phase
    ];

    $scope.sysinfo = {
        provider: 'generic',
        ip: '',
        ifname: ''
    };

    $scope.sysinfoProvider = [
        { name: 'Public IP', value: 'generic' },
        { name: 'Static IP Address', value: 'fixed' },
        { name: 'Network Interface', value: 'network-interface' }
    ];

    $scope.prettySysinfoProviderName = function (provider) {
        switch (provider) {
        case 'generic': return 'Public IP';
        case 'fixed': return 'Static IP Address';
        case 'network-interface': return 'Network Interface';
        default: return 'Unknown';
        }
    };

    $scope.needsPort80 = function (dnsProvider, tlsProvider) {
        return ((dnsProvider === 'manual' || dnsProvider === 'noop' || dnsProvider === 'wildcard') &&
            (tlsProvider === 'letsencrypt-prod' || tlsProvider === 'letsencrypt-staging'));
    };

    // If we migrate the api origin we have to poll the new location
    if (search.admin_fqdn) Client.apiOrigin = 'https://' + search.admin_fqdn;

    $scope.$watch('dnsCredentials.domain', function (newVal) {
        if (!newVal) {
            $scope.isDomain = false;
            $scope.isSubdomain = false;
        } else if (!tld.getDomain(newVal) || newVal[newVal.length-1] === '.') {
            $scope.isDomain = false;
            $scope.isSubdomain = false;
        } else {
            $scope.isDomain = true;
            $scope.isSubdomain = tld.getDomain(newVal) !== newVal;
        }
    });

    // keep in sync with domains.js
    $scope.dnsProvider = [
        { name: 'AWS Route53', value: 'route53' },
        { name: 'Cloudflare', value: 'cloudflare' },
        { name: 'DigitalOcean', value: 'digitalocean' },
        { name: 'Gandi LiveDNS', value: 'gandi' },
        { name: 'GoDaddy', value: 'godaddy' },
        { name: 'Google Cloud DNS', value: 'gcdns' },
        { name: 'Linode', value: 'linode' },
        { name: 'Name.com', value: 'namecom' },
        { name: 'Namecheap', value: 'namecheap' },
        { name: 'Netcup', value: 'netcup' },
        { name: 'Vultr', value: 'vultr' },
        { name: 'Wildcard', value: 'wildcard' },
        { name: 'Manual (not recommended)', value: 'manual' },
        { name: 'No-op (only for development)', value: 'noop' }
    ];
    $scope.dnsCredentials = {
        busy: false,
        domain: 'CWMDOMAIN',
        accessKeyId: '',
        secretAccessKey: '',
        gcdnsKey: { keyFileName: '', content: '' },
        digitalOceanToken: '',
        gandiApiKey: '',
        cloudflareEmail: '',
        cloudflareToken: '',
        cloudflareTokenType: 'GlobalApiKey',
        godaddyApiKey: '',
        godaddyApiSecret: '',
        linodeToken: '',
        vultrToken: '',
        nameComUsername: '',
        nameComToken: '',
        namecheapUsername: '',
        namecheapApiKey: '',
        netcupCustomerNumber: '',
        netcupApiKey: '',
        netcupApiPassword: '',
        provider: 'manual',
        zoneName: '',
        tlsConfig: {
            provider: 'letsencrypt-prod'
        }
    };

    $scope.setDefaultTlsProvider = function () {
        var dnsProvider = $scope.dnsCredentials.provider;
        // wildcard LE won't work without automated DNS
        if (dnsProvider === 'manual' || dnsProvider === 'noop' || dnsProvider === 'wildcard') {
            $scope.dnsCredentials.tlsConfig.provider = 'letsencrypt-prod';
        } else {
            $scope.dnsCredentials.tlsConfig.provider = 'letsencrypt-prod-wildcard';
        }
    };


    function readFileLocally(obj, file, fileName) {
        return function (event) {
            $scope.$apply(function () {
                obj[file] = null;
                obj[fileName] = event.target.files[0].name;

                var reader = new FileReader();
                reader.onload = function (result) {
                    if (!result.target || !result.target.result) return console.error('Unable to read local file');
                    obj[file] = result.target.result;
                };
                reader.readAsText(event.target.files[0]);
            });
        };
    }

    document.getElementById('gcdnsKeyFileInput').onchange = readFileLocally($scope.dnsCredentials.gcdnsKey, 'content', 'keyFileName');

    $scope.setDnsCredentials = function () {
        $scope.dnsCredentials.busy = true;
        $scope.error = {};

        var provider = $scope.dnsCredentials.provider;

        var config = {};

        if (provider === 'route53') {
            config.accessKeyId = $scope.dnsCredentials.accessKeyId;
            config.secretAccessKey = $scope.dnsCredentials.secretAccessKey;
        } else if (provider === 'gcdns') {
            try {
                var serviceAccountKey = JSON.parse($scope.dnsCredentials.gcdnsKey.content);
                config.projectId = serviceAccountKey.project_id;
                config.credentials = {
                    client_email: serviceAccountKey.client_email,
                    private_key: serviceAccountKey.private_key
                };

                if (!config.projectId || !config.credentials || !config.credentials.client_email || !config.credentials.private_key) {
                    throw new Error('One or more fields are missing in the JSON');
                }
            } catch (e) {
                $scope.error.dnsCredentials = 'Cannot parse Google Service Account Key: ' + e.message;
                $scope.dnsCredentials.busy = false;
                return;
            }
        } else if (provider === 'digitalocean') {
            config.token = $scope.dnsCredentials.digitalOceanToken;
        } else if (provider === 'gandi') {
            config.token = $scope.dnsCredentials.gandiApiKey;
        } else if (provider === 'godaddy') {
            config.apiKey = $scope.dnsCredentials.godaddyApiKey;
            config.apiSecret = $scope.dnsCredentials.godaddyApiSecret;
        } else if (provider === 'cloudflare') {
            config.email = $scope.dnsCredentials.cloudflareEmail;
            config.token = $scope.dnsCredentials.cloudflareToken;
            config.tokenType = $scope.dnsCredentials.cloudflareTokenType;
        } else if (provider === 'linode') {
            config.token = $scope.dnsCredentials.linodeToken;
        } else if (provider === 'vultr') {
            config.token = $scope.dnsCredentials.vultrToken;
        } else if (provider === 'namecom') {
            config.username = $scope.dnsCredentials.nameComUsername;
            config.token = $scope.dnsCredentials.nameComToken;
        } else if (provider === 'namecheap') {
            config.token = $scope.dnsCredentials.namecheapApiKey;
            config.username = $scope.dnsCredentials.namecheapUsername;
        } else if (provider === 'netcup') {
            config.customerNumber = $scope.dnsCredentials.netcupCustomerNumber;
            config.apiKey = $scope.dnsCredentials.netcupApiKey;
            config.apiPassword = $scope.dnsCredentials.netcupApiPassword;
        }

        var tlsConfig = {
            provider: $scope.dnsCredentials.tlsConfig.provider,
            wildcard: false
        };
        if ($scope.dnsCredentials.tlsConfig.provider.indexOf('-wildcard') !== -1) {
            tlsConfig.provider = tlsConfig.provider.replace('-wildcard', '');
            tlsConfig.wildcard = true;
        }

        var sysinfoConfig = {
            provider: $scope.sysinfo.provider
        };
        if ($scope.sysinfo.provider === 'fixed') {
            sysinfoConfig.ip = $scope.sysinfo.ip;
        } else if ($scope.sysinfo.provider === 'network-interface') {
            sysinfoConfig.ifname = $scope.sysinfo.ifname;
        }

        var data = {
            dnsConfig: {
                domain: $scope.dnsCredentials.domain,
                zoneName: $scope.dnsCredentials.zoneName,
                provider: provider,
                config: config,
                tlsConfig: tlsConfig
            },
            sysinfoConfig: sysinfoConfig,
            providerToken: $scope.instanceId,
            setupToken: $scope.setupToken
        };

        Client.setup(data, function (error) {
            if (error) {
                $scope.dnsCredentials.busy = false;
                if (error.statusCode === 422) {
                    if (provider === 'ami') {
                        $scope.error.ami = error.message;
                    } else {
                        $scope.error.setup = error.message;
                    }
                } else {
                    $scope.error.dnsCredentials = error.message;
                }
                return;
            }

            waitForDnsSetup();
        });
    };

    function waitForDnsSetup() {
        $scope.state = 'waitingForDnsSetup';

        Client.getStatus(function (error, status) {
            if (!error && !status.setup.active) {
                if (!status.adminFqdn || status.setup.errorMessage) { // setup reset or errored. start over
                    $scope.error.setup = status.setup.errorMessage;
                    $scope.state = 'initialized';
                    $scope.dnsCredentials.busy = false;
                } else { // proceed to activation
                    window.location.href = 'https://' + status.adminFqdn + '/setup.html' + (window.location.search);
                }
                return;
            }

            $scope.message = status.setup.message;

            setTimeout(waitForDnsSetup, 5000);
        });
    }

    function initialize() {
        Client.getStatus(function (error, status) {
            if (error) {
                // During domain migration, the box code restarts and can result in getStatus() failing temporarily
                console.error(error);
                $scope.state = 'waitingForBox';
                return $timeout(initialize, 3000);
            }

            // domain is currently like a lock flag
            if (status.adminFqdn) return waitForDnsSetup();

            if (status.provider === 'digitalocean' || status.provider === 'digitalocean-mp') {
                $scope.dnsCredentials.provider = 'digitalocean';
            } else if (status.provider === 'linode' || status.provider === 'linode-oneclick' || status.provider === 'linode-stackscript') {
                $scope.dnsCredentials.provider = 'linode';
            } else if (status.provider === 'vultr' || status.provider === 'vultr-mp') {
                $scope.dnsCredentials.provider = 'vultr';
            } else if (status.provider === 'gce') {
                $scope.dnsCredentials.provider = 'gcdns';
            } else if (status.provider === 'ami') {
                $scope.dnsCredentials.provider = 'route53';
            }

            $scope.instanceId = search.instanceId;
            $scope.setupToken = search.setupToken;
            $scope.provider = status.provider;
            $scope.webServerOrigin = status.webServerOrigin;
            $scope.state = 'initialized';

            setTimeout(function () { $("[autofocus]:first").focus(); }, 100);
        });
    }

    var clipboard = new Clipboard('.clipboard');
    clipboard.on('success', function () {
        $scope.$apply(function () { $scope.clipboardDone = true; });
        $timeout(function () { $scope.clipboardDone = false; }, 5000);
    });

    initialize();
}]);
;'use strict';

/* global $ */
/* global angular */
/* global EventSource */
/* global async */

// keep in sync with box/src/apps.js
var ISTATES = {
    PENDING_INSTALL: 'pending_install',
    PENDING_CLONE: 'pending_clone',
    PENDING_CONFIGURE: 'pending_configure',
    PENDING_UNINSTALL: 'pending_uninstall',
    PENDING_RESTORE: 'pending_restore',
    PENDING_IMPORT: 'pending_import',
    PENDING_UPDATE: 'pending_update',
    PENDING_BACKUP: 'pending_backup',
    PENDING_RECREATE_CONTAINER: 'pending_recreate_container', // env change or addon change
    PENDING_LOCATION_CHANGE: 'pending_location_change',
    PENDING_DATA_DIR_MIGRATION: 'pending_data_dir_migration',
    PENDING_RESIZE: 'pending_resize',
    PENDING_DEBUG: 'pending_debug',
    PENDING_START: 'pending_start',
    PENDING_STOP: 'pending_stop',
    PENDING_RESTART: 'pending_restart',
    ERROR: 'error',
    INSTALLED: 'installed'
};

var HSTATES = {
    HEALTHY: 'healthy',
    UNHEALTHY: 'unhealthy',
    ERROR: 'error',
    DEAD: 'dead'
};

var RSTATES ={
    RUNNING: 'running',
    STOPPED: 'stopped'
};

var ERROR = {
    ACCESS_DENIED: 'Access Denied',
    ALREADY_EXISTS: 'Already Exists',
    BAD_FIELD: 'Bad Field',
    COLLECTD_ERROR: 'Collectd Error',
    CONFLICT: 'Conflict',
    DATABASE_ERROR: 'Database Error',
    DNS_ERROR: 'DNS Error',
    DOCKER_ERROR: 'Docker Error',
    EXTERNAL_ERROR: 'External Error',
    FS_ERROR: 'FileSystem Error',
    INTERNAL_ERROR: 'Internal Error',
    LOGROTATE_ERROR: 'Logrotate Error',
    NETWORK_ERROR: 'Network Error',
    NOT_FOUND: 'Not found',
    REVERSEPROXY_ERROR: 'ReverseProxy Error',
    TASK_ERROR: 'Task Error',
    UNKNOWN_ERROR: 'Unknown Error' // only used for portin,
};

var ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    USER_MANAGER: 'usermanager',
    USER: 'user'
};

// sync up with tasks.js
var TASK_TYPES = {
    TASK_APP: 'app',
    TASK_BACKUP: 'backup',
    TASK_UPDATE: 'update',
    TASK_RENEW_CERTS: 'renewcerts',
    TASK_SETUP_DNS_AND_CERT: 'setupDnsAndCert',
    TASK_CLEAN_BACKUPS: 'cleanBackups',
    TASK_SYNC_EXTERNAL_LDAP: 'syncExternalLdap',
    TASK_CHANGE_MAIL_LOCATION: 'changeMailLocation',
    TASK_SYNC_DNS_RECORDS: 'syncDnsRecords',
};

var SECRET_PLACEHOLDER = String.fromCharCode(0x25CF).repeat(8);

// ----------------------------------------------
// Helper to ensure loading a fallback app icon on first load failure
// ----------------------------------------------
function imageErrorHandler(elem) {
    elem.src = elem.getAttribute('fallback-icon');
    elem.onerror = null;    // avoid retry after default icon cannot be loaded
}

// ----------------------------------------------
// Shared Angular Filters
// ----------------------------------------------

// binary units (non SI) 1024 based
function prettyByteSize(size, fallback) {
    if (!size) return fallback || 0;

    var i = Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

angular.module('Application').filter('prettyByteSize', function () {
    return function (size, fallback) { return prettyByteSize(size, fallback) || '0 kb'; };
});

angular.module('Application').filter('prettyDiskSize', function () {
    return function (size, fallback) { return prettyByteSize(size, fallback) || 'Not available yet'; };
});

angular.module('Application').filter('trKeyFromPeriod', function () {
    return function (period) {
        if (period === 6) return 'app.graphs.period.6h';
        if (period === 12) return 'app.graphs.period.12h';
        if (period === 24) return 'app.graphs.period.24h';
        if (period === 24*7) return 'app.graphs.period.7d';
        if (period === 24*30) return 'app.graphs.period.30d';

        return '';
    };
});

angular.module('Application').filter('prettyDate', function ($translate) {
    // http://ejohn.org/files/pretty.js
    return function prettyDate(utc) {
        var date = new Date(utc), // this converts utc into browser timezone and not cloudron timezone!
            diff = (((new Date()).getTime() - date.getTime()) / 1000) + 30, // add 30seconds for clock skew
            day_diff = Math.floor(diff / 86400);

        if (isNaN(day_diff) || day_diff < 0) return $translate.instant('main.prettyDate.justNow', {});

        return day_diff === 0 && (
                diff < 60 && $translate.instant('main.prettyDate.justNow', {}) ||
                diff < 120 && $translate.instant('main.prettyDate.minutesAgo', { m: 1 }) ||
                diff < 3600 && $translate.instant('main.prettyDate.minutesAgo', { m: Math.floor( diff / 60 ) }) ||
                diff < 7200 && $translate.instant('main.prettyDate.hoursAgo', { h: 1 }) ||
                diff < 86400 && $translate.instant('main.prettyDate.hoursAgo', { h: Math.floor( diff / 3600 ) })
            ) ||
            day_diff === 1 && $translate.instant('main.prettyDate.yeserday', {}) ||
            day_diff < 7 && $translate.instant('main.prettyDate.daysAgo', { d: day_diff }) ||
            day_diff < 31 && $translate.instant('main.prettyDate.weeksAgo', { w: Math.ceil( day_diff / 7 ) }) ||
            day_diff < 365 && $translate.instant('main.prettyDate.monthsAgo', { m: Math.round( day_diff / 30 ) }) ||
                              $translate.instant('main.prettyDate.yearsAgo', { m: Math.round( day_diff / 365 ) });
    };
});

angular.module('Application').filter('prettyLongDate', function () {
    return function prettyLongDate(utc) {
        return moment(utc).format('MMMM Do YYYY, h:mm:ss a'); // this converts utc into browser timezone and not cloudron timezone!
    };
});

angular.module('Application').filter('prettyShortDate', function () {
    return function prettyShortDate(utc) {
        return moment(utc).format('MMMM Do YYYY'); // this converts utc into browser timezone and not cloudron timezone!
    };
});

angular.module('Application').filter('markdown2html', function () {
    var converter = new showdown.Converter({
        simplifiedAutoLink: true,
        strikethrough: true,
        tables: true,
        openLinksInNewWindow: true
    });

    // without this cache, the code runs into some infinite loop (https://github.com/angular/angular.js/issues/3980)
    var cache = {};

    return function (text) {
        if (cache[text]) return cache[text];
        cache[text] = converter.makeHtml(text);
        return cache[text];
    };
});

angular.module('Application').config(['$translateProvider', function ($translateProvider) {
    $translateProvider.useStaticFilesLoader({
        prefix: 'translation/',
        suffix: '.json?' + '366949753194ccb941d2cd07130d5d24c17ac365'
    });
    $translateProvider.useLocalStorage();
    $translateProvider.preferredLanguage('en');
    $translateProvider.fallbackLanguage('en');
}]);

// Add shorthand "tr" filter to avoid having ot use "translate"
// This is a copy of the code at https://github.com/angular-translate/angular-translate/blob/master/src/filter/translate.js
// If we find out how to get that function handle somehow dynamically we can use that, otherwise the copy is required
function translateFilterFactory($parse, $translate) {
  var translateFilter = function (translationId, interpolateParams, interpolation, forceLanguage) {
    if (!angular.isObject(interpolateParams)) {
      var ctx = this || {
        '__SCOPE_IS_NOT_AVAILABLE': 'More info at https://github.com/angular/angular.js/commit/8863b9d04c722b278fa93c5d66ad1e578ad6eb1f'
        };
      interpolateParams = $parse(interpolateParams)(ctx);
    }

    return $translate.instant(translationId, interpolateParams, interpolation, forceLanguage);
  };

  if ($translate.statefulFilter()) {
    translateFilter.$stateful = true;
  }

  return translateFilter;
}
translateFilterFactory.displayName = 'translateFilterFactory';
angular.module('Application').filter('tr', translateFilterFactory);


// ----------------------------------------------
// Cloudron REST API wrapper
// ----------------------------------------------

angular.module('Application').service('Client', ['$http', '$interval', '$timeout', 'md5', 'Notification', function ($http, $interval, $timeout, md5, Notification) {
    var client = null;

    // variable available only here to avoid this._property pattern
    var token = null;

    function ClientError(statusCode, messageOrObject) {
        Error.call(this);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        if (messageOrObject === null || typeof messageOrObject === 'undefined') {
            this.message = 'Empty message or object';
        } else if (typeof messageOrObject === 'string') {
            this.message = messageOrObject;
        } else if (messageOrObject) {
            angular.extend(this, messageOrObject); // status, message, reason and other properties
        }
    }

    function defaultErrorHandler(callback) {
        function handleServerOffline() {
            if (client.offline) return;
            client.offline = true;

            (function onlineCheck() {
                $http.get(client.apiOrigin + '/api/v1/cloudron/status', {}).success(function (data, status) {
                    client.offline = false;
                    client._reconnectListener.forEach(function (handler) { handler(); });
                }).error(function (data, status) {
                    $timeout(onlineCheck, 5000);
                });
            })();
        }

        return function (data, status) {
            // handle request killed by browser (eg. cors issue)
            if (data === null && status === -1) {
                handleServerOffline();
                return callback(new ClientError('Request cancelled by browser'));
            }

            // re-login will make the code get a new token
            if (status === 401) return client.login();

            if (status === 500 || status === 501) {
                // actual internal server error, most likely a bug or timeout log to console only to not alert the user
                if (!client.offline) {
                    console.error(status, data);
                    console.log('------\nCloudron Internal Error\n\nIf you see this, please send a mail with above log to support@cloudron.io\n------\n');
                }
            } else if (status === 502 || status === 503 || status === 504) {
                // This means the box service is not reachable. We just show offline banner for now
            }

            if (status >= 502) {
                handleServerOffline();
                return callback(new ClientError(status, data));
            }

            var obj = data;
            try {
                obj = JSON.parse(data);
            } catch (e) {}

            callback(new ClientError(status, obj));
        };
    }

    function defaultSuccessHandler(callback) {
        return function (data, status) {
            return callback(null, data, status);
        };
    }

    // XHR wrapper to set the auth header
    function get(url, config, callback) {
        if (arguments.length !== 3) {
            console.error('GET', arguments);
            throw('Wrong number of arguments');
        }

        config = config || {};
        config.headers = config.headers || {};
        config.headers.Authorization = 'Bearer ' + token;

        return $http.get(client.apiOrigin + url, config)
            .success(defaultSuccessHandler(callback))
            .error(defaultErrorHandler(callback));
    }

    function head(url, config, callback) {
        if (arguments.length !== 3) {
            console.error('HEAD', arguments);
            throw('Wrong number of arguments');
        }

        config = config || {};
        config.headers = config.headers || {};
        config.headers.Authorization = 'Bearer ' + token;

        return $http.head(client.apiOrigin + url, config)
            .success(defaultSuccessHandler(callback))
            .error(defaultErrorHandler(callback));
    }

    function post(url, data, config, callback) {
        if (arguments.length !== 4) {
            console.error('POST', arguments);
            throw('Wrong number of arguments');
        }

        data = data || {};
        config = config || {};
        config.headers = config.headers || {};
        config.headers.Authorization = 'Bearer ' + token;

        return $http.post(client.apiOrigin + url, data, config)
            .success(defaultSuccessHandler(callback))
            .error(defaultErrorHandler(callback));
    }

    function put(url, data, config, callback) {
        if (arguments.length !== 4) {
            console.error('PUT', arguments);
            throw('Wrong number of arguments');
        }

        data = data || {};
        config = config || {};
        config.headers = config.headers || {};
        config.headers.Authorization = 'Bearer ' + token;

        return $http.put(client.apiOrigin + url, data, config)
            .success(defaultSuccessHandler(callback))
            .error(defaultErrorHandler(callback));
    }

    function del(url, config, callback) {
        if (arguments.length !== 3) {
            console.error('DEL', arguments);
            throw('Wrong number of arguments');
        }

        config = config || {};
        config.headers = config.headers || {};
        config.headers.Authorization = 'Bearer ' + token;

        return $http.delete(client.apiOrigin + url, config)
            .success(defaultSuccessHandler(callback))
            .error(defaultErrorHandler(callback));
    }

    function Client() {
        this.offline = false;
        this._ready = false;
        this._configListener = [];
        this._readyListener = [];
        this._reconnectListener = [];
        this._userInfo = {
            id: null,
            username: null,
            email: null,
            twoFactorAuthenticationEnabled: false,
            source: null,
            avatarUrl: null
        };
        this._config = {
            apiServerOrigin: null,
            webServerOrigin: null,
            fqdn: null,
            ip: null,
            revision: null,
            update: { box: null, apps: null },
            progress: {},
            region: null,
            size: null
        };
        this._installedApps = [];
        this._installedAppsById = {};
        this._appTags = [];
        // window.location fallback for websocket connections which do not have relative uris
        this.apiOrigin = '' || window.location.origin;
        this.avatar = '';
        this._availableLanguages = ['en'];
        this._appstoreAppCache = [];

        this.resetAvatar();

        this.setToken(localStorage.token);
    }

    Client.prototype.error = function (error, action) {
        var message = '';

        console.error(error);

        if (typeof error === 'object') {
            message = error.message || error;
        } else {
            message = error;
        }

        // give more info in case the error was a request which failed with empty response body,
        // this happens mostly if the box crashes
        if (message === 'Empty message or object') {
            message = 'Got empty response. Click to check the server logs.';
            action = action || '/logs.html?id=box';
        }

        this.notify('Cloudron Error', message, true, 'error', action);
    };

    // handles application startup errors, mostly only when dashboard is loaded and api endpoint is down
    Client.prototype.initError = function (error, initFunction) {
        console.error('Application startup error', error);

        $timeout(initFunction, 5000); // we will try to re-init the app
    };

    Client.prototype.clearNotifications = function () {
        Notification.clearAll();
    };

    /*

    If `action` is a non-empty string, it will be treated as a url, if it is a function, that function will be exectued on click

    */
    Client.prototype.notify = function (title, message, persistent, type, action) {
        var options = { title: title, message: message};

        if (persistent) options.delay = 'never'; // any non Number means never timeout

        if (action) {
            options.onClick = function (/* params */) {
                // if action is a string, we assume it is a link
                if (typeof action === 'string' && action !== '') window.location = action;
                else if (typeof action === 'function') action();
                else console.warn('Notification action is not supported.', action);
            };
        }

        if (type === 'error') Notification.error(options);
        else if (type === 'success') Notification.success(options);
        else if (type === 'info') Notification.info(options);
        else if (type === 'warning') Notification.warning(options);
        else throw('Invalid notification type "' + type + '"');
    };

    Client.prototype.setReady = function () {
        if (this._ready) return;

        this._ready = true;
        this._readyListener.forEach(function (callback) {
            callback();
        });

        // clear the listeners, we only callback once!
        this._readyListener = [];
    };

    Client.prototype.onReady = function (callback) {
        if (this._ready) callback();
        else this._readyListener.push(callback);
    };

    Client.prototype.onConfig = function (callback) {
        this._configListener.push(callback);
        if (this._config && this._config.apiServerOrigin) callback(this._config);
    };

    Client.prototype.onReconnect = function (callback) {
        if (this._ready) callback();
        else this._reconnectListener.push(callback);
    };

    Client.prototype.resetAvatar = function () {
        this.avatar = this.apiOrigin + '/api/v1/cloudron/avatar?' + String(Math.random()).slice(2);

        var favicon = $('#favicon');
        if (favicon) favicon.attr('href', this.avatar);
    };

    Client.prototype.setUserInfo = function (userInfo) {
        // In order to keep the angular bindings alive, set each property individually
        this._userInfo.id = userInfo.id;
        this._userInfo.username = userInfo.username;
        this._userInfo.email = userInfo.email;
        this._userInfo.fallbackEmail = userInfo.fallbackEmail;
        this._userInfo.displayName = userInfo.displayName;
        this._userInfo.twoFactorAuthenticationEnabled = userInfo.twoFactorAuthenticationEnabled;
        this._userInfo.role = userInfo.role;
        this._userInfo.source = userInfo.source;
        this._userInfo.avatarUrl = userInfo.avatarUrl + '?s=128&default=mp&ts=' + Date.now(); // we add the timestamp to avoid caching
        this._userInfo.isAtLeastOwner = [ ROLES.OWNER ].indexOf(userInfo.role) !== -1;
        this._userInfo.isAtLeastAdmin = [ ROLES.OWNER, ROLES.ADMIN ].indexOf(userInfo.role) !== -1;
        this._userInfo.isAtLeastUserManager = [ ROLES.OWNER, ROLES.ADMIN, ROLES.USER_MANAGER ].indexOf(userInfo.role) !== -1;
    };

    Client.prototype.setConfig = function (config) {
        var that = this;

        angular.copy(config, this._config);



        // => This is just for easier testing
        // this._config.features.userMaxCount = 5;
        // this._config.features.userRoles = false;
        // this._config.features.userGroups = false;
        // this._config.features.domainMaxCount = 1;
        // this._config.features.externalLdap = false;
        // this._config.features.privateDockerRegistry = false;
        // this._config.features.branding = true;
        // this._config.features.support = true;
        // this._config.features.directoryConfig = true;
        // this._config.features.mailboxMaxCount = 5;
        // this._config.features.emailPremium = false;

        this._configListener.forEach(function (callback) {
            callback(that._config);
        });
    };

    Client.prototype.getInstalledApps = function () {
        return this._installedApps;
    };

    Client.prototype.getAppTags = function () {
        return this._appTags;
    };

    Client.prototype.getUserInfo = function () {
        return this._userInfo;
    };

    Client.prototype.getConfig = function () {
        return this._config;
    };

    Client.prototype.getAvailableLanguages = function () {
        return this._availableLanguages;
    };

    Client.prototype.setToken = function (accessToken) {
        if (!accessToken) localStorage.removeItem('token');
        else localStorage.token = accessToken;

        // set the token closure
        token = accessToken;
    };

    Client.prototype.getToken = function () {
        return token;
    };

    Client.prototype.makeURL = function (url) {
        if (url.indexOf('?') === -1) {
            return this.apiOrigin + url + '?access_token=' + token;
        } else {
            return this.apiOrigin + url + '&access_token=' + token;
        }
    };

    /*
     * Rest API wrappers
     */
    Client.prototype.config = function (callback) {
        get('/api/v1/config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200 || typeof data !== 'object') return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.userInfo = function (callback) {
        get('/api/v1/profile', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200 || typeof data !== 'object') return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.changeCloudronAvatar = function (avatarFile, callback) {
        var fd = new FormData();
        fd.append('avatar', avatarFile);

        var config = {
            headers: { 'Content-Type': undefined },
            transformRequest: angular.identity
        };

        post('/api/v1/branding/cloudron_avatar', fd, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.changeCloudronName = function (name, callback) {
        var data = {
            name: name
        };

        post('/api/v1/branding/cloudron_name', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.installApp = function (id, manifest, title, config, callback) {
        var that = this;
        var data = {
            appStoreId: id + '@' + manifest.version,
            location: config.location,
            domain: config.domain,
            portBindings: config.portBindings,
            accessRestriction: config.accessRestriction,
            cert: config.cert,
            key: config.key,
            sso: config.sso,
            overwriteDns: config.overwriteDns
        };

        post('/api/v1/apps/install', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.id);
        });
    };

    Client.prototype.cloneApp = function (appId, config, callback) {
        var data = {
            location: config.location,
            domain: config.domain,
            portBindings: config.portBindings,
            backupId: config.backupId
        };

        post('/api/v1/apps/' + appId + '/clone', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.restoreApp = function (appId, backupId, callback) {
        var data = { backupId: backupId };

        post('/api/v1/apps/' + appId + '/restore', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.backupApp = function (appId, callback) {
        var data = {};

        post('/api/v1/apps/' + appId + '/backup', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.uninstallApp = function (appId, callback) {
        var data = {};

        post('/api/v1/apps/' + appId + '/uninstall', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.configureApp = function (id, setting, data, callback) {
        post('/api/v1/apps/' + id + '/configure/' + setting, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200 && status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.repairApp = function (id, data, callback) {
        post('/api/v1/apps/' + id + '/repair', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200 && status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.updateApp = function (id, manifest, options, callback) {
        var data =  {
            appStoreId: manifest.id + '@' + manifest.version,
            skipBackup: !!options.skipBackup
        };

        post('/api/v1/apps/' + id + '/update', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.startApp = function (id, callback) {
        post('/api/v1/apps/' + id + '/start', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.stopApp = function (id, callback) {
        post('/api/v1/apps/' + id + '/stop', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.restartApp = function (id, callback) {
        post('/api/v1/apps/' + id + '/restart', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.debugApp = function (id, state, callback) {
        var data = {
            debugMode: state ? {
                readonlyRootfs: false,
                cmd: [ '/bin/bash', '-c', 'echo "Repair mode. Use the webterminal or cloudron exec to repair. Sleeping" && sleep infinity' ]
            } : null
        };

        post('/api/v1/apps/' + id + '/configure/debug_mode', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.version = function (callback) {
        get('/api/v1/cloudron/status', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.getStatus = function (callback) {
        get('/api/v1/cloudron/status', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200 || typeof data !== 'object') return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.setBackupConfig = function (backupConfig, callback) {
        post('/api/v1/settings/backup_config', backupConfig, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getBackupConfig = function (callback) {
        get('/api/v1/settings/backup_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getSupportConfig = function (callback) {
        get('/api/v1/settings/support_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setExternalLdapConfig = function (config, callback) {
        post('/api/v1/settings/external_ldap_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getExternalLdapConfig = function (callback) {
        get('/api/v1/settings/external_ldap_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setDirectoryConfig = function (config, callback) {
        post('/api/v1/settings/directory_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getDirectoryConfig = function (callback) {
        get('/api/v1/settings/directory_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    // network
    Client.prototype.setSysinfoConfig = function (config, callback) {
        post('/api/v1/settings/sysinfo_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getServerIp = function (callback) {
        get('/api/v1/cloudron/server_ip', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.ip);
        });
    };

    Client.prototype.getSysinfoConfig = function (callback) {
        get('/api/v1/settings/sysinfo_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getBlocklist = function (callback) {
        var config = {};

        get('/api/v1/network/blocklist', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.blocklist);
        });
    };

    Client.prototype.setBlocklist = function (blocklist, callback) {
        post('/api/v1/network/blocklist', { blocklist: blocklist }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.setDynamicDnsConfig = function (enabled, callback) {
        post('/api/v1/settings/dynamic_dns', { enabled: enabled }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.getDynamicDnsConfig = function (callback) {
        get('/api/v1/settings/dynamic_dns', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.enabled);
        });
    };

    // branding
    Client.prototype.setFooter = function (footer, callback) {
        post('/api/v1/branding/footer', { footer: footer }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getFooter = function (callback) {
        get('/api/v1/branding/footer', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.footer);
        });
    };

    Client.prototype.setUnstableAppsConfig = function (enabled, callback) {
        post('/api/v1/settings/unstable_apps', { enabled: enabled }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.getUnstableAppsConfig = function (callback) {
        get('/api/v1/settings/unstable_apps', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.enabled);
        });
    };

    Client.prototype.setRegistryConfig = function (rc, callback) {
        post('/api/v1/settings/registry_config', rc, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.getRegistryConfig = function (callback) {
        get('/api/v1/settings/registry_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.getUpdateInfo = function (callback) {
        if (!this._userInfo.isAtLeastAdmin) return callback(new Error('Not allowed'));

        get('/api/v1/cloudron/update', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.checkForUpdates = function (callback) {
        post('/api/v1/cloudron/check_for_updates', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            client.refreshConfig(callback);
        });
    };

    Client.prototype.setAutoupdatePattern = function (pattern, callback) {
        post('/api/v1/settings/autoupdate_pattern', { pattern: pattern }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getAutoupdatePattern = function (callback) {
        get('/api/v1/settings/autoupdate_pattern', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setTimeZone = function (timeZone, callback) {
        post('/api/v1/settings/time_zone', { timeZone: timeZone }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getTimeZone = function (callback) {
        get('/api/v1/settings/time_zone', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.timeZone);
        });
    };

    Client.prototype.setLanguage = function (language, callback) {
        post('/api/v1/settings/language', { language: language }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getLanguage = function (callback) {
        get('/api/v1/settings/language', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.language);
        });
    };

    Client.prototype.getRemoteSupport = function (callback) {
        get('/api/v1/support/remote_support', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.enabled);
        });
    };

    Client.prototype.enableRemoteSupport = function (enable, callback) {
        post('/api/v1/support/remote_support', { enable: enable }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getBackups = function (callback) {
        get('/api/v1/backups', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.backups);
        });
    };

    Client.prototype.getLatestTaskByType = function (type, callback) {
        get('/api/v1/tasks?page=1&per_page=1&type=' + type, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.tasks.length ? data.tasks[0] : null);
        });
    };

    Client.prototype.getTask = function (taskId, callback) {
        get('/api/v1/tasks/' + taskId, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getTaskLogs = function (taskId, follow, lines, callback) {
        if (follow) {
            var eventSource = new EventSource(client.apiOrigin + '/api/v1/tasks/' + taskId + '/logstream?lines=' + lines + '&access_token=' + token);
            callback(null, eventSource);
        } else {
            get('/api/v1/services/' + taskId + '/logs?lines=' + lines, null, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                callback(null, data);
            });
        }
    };

    Client.prototype.startBackup = function (callback) {
        post('/api/v1/backups/create', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.cleanupBackups = function (callback) {
        post('/api/v1/backups/cleanup', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.stopTask = function (taskId, callback) {
        post('/api/v1/tasks/' + taskId + '/stop', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.restore = function (backupConfig, backupId, version, sysinfoConfig, skipDnsSetup, callback) {
        var data = {
            backupConfig: backupConfig,
            backupId: backupId,
            version: version,
            sysinfoConfig: sysinfoConfig,
            skipDnsSetup: skipDnsSetup
        };

        post('/api/v1/cloudron/restore', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status));

            callback(null);
        });
    };

    Client.prototype.importBackup = function (appId, backupId, backupFormat, backupConfig, callback) {
        var data = {
            backupId: backupId,
            backupFormat: backupFormat,
            backupConfig: backupConfig,
        };

        post('/api/v1/apps/' + appId + '/import', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status));

            callback(null);
        });
    };

    Client.prototype.getNotifications = function (options, page, perPage, callback) {
        var config = {
            params: {
                page: page,
                per_page: perPage
            }
        };

        if (typeof options.acknowledged === 'boolean') config.params.acknowledged = options.acknowledged;

        get('/api/v1/notifications', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.notifications);
        });
    };

    Client.prototype.ackNotification = function (notificationId, acknowledged, callback) {
        post('/api/v1/notifications/' + notificationId, { acknowledged: acknowledged }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status));

            callback(null);
        });
    };

    Client.prototype.getEvent = function (eventId, callback) {
        get('/api/v1/cloudron/eventlog/' + eventId, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.event);
        });
    };

    Client.prototype.getEventLogs = function (actions, search, page, perPage, callback) {
        var config = {
            params: {
                actions: actions,
                search: search,
                page: page,
                per_page: perPage
            }
        };

        get('/api/v1/cloudron/eventlog', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.eventlogs);
        });
    };

    Client.prototype.getPlatformLogs = function (unit, follow, lines, callback) {
        if (follow) {
            var eventSource = new EventSource(client.apiOrigin + '/api/v1/cloudron/logstream/' + unit + '?lines=' + lines + '&access_token=' + token);
            callback(null, eventSource);
        } else {
            get('/api/v1/cloudron/logs/' + unit + '?lines=' + lines, null, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                callback(null, data);
            });
        }
    };

    Client.prototype.getServiceLogs = function (serviceName, follow, lines, callback) {
        if (follow) {
            var eventSource = new EventSource(client.apiOrigin + '/api/v1/services/' + serviceName + '/logstream?lines=' + lines + '&access_token=' + token);
            callback(null, eventSource);
        } else {
            get('/api/v1/services/' + serviceName + '/logs?lines=' + lines, null, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                callback(null, data);
            });
        }
    };

    Client.prototype.getApps = function (callback) {
        var that = this;

        get('/api/v1/apps', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            var apps = data.apps;
            for (var i = 0; i < apps.length; i++) {
                that._appPostProcess(apps[i]); // this will also set the correct iconUrl
            }

            callback(null, apps);
        });
    };

    Client.prototype.getAppLogs = function (appId, follow, lines, callback) {
        if (follow) {
            var eventSource = new EventSource(client.apiOrigin + '/api/v1/apps/' + appId + '/logstream?lines=' + lines + '&access_token=' + token);
            callback(null, eventSource);
        } else {
            get('/api/v1/apps/' + appId + '/logs', null, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                callback(null, data);
            });
        }
    };

    Client.prototype.getAppBackups = function (appId, callback) {
        get('/api/v1/apps/' + appId + '/backups', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.backups);
        });
    };

    Client.prototype.getServices = function (callback) {
        get('/api/v1/services', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.services);
        });
    };

    Client.prototype.getService = function (serviceName, callback) {
        get('/api/v1/services/' + serviceName, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.service);
        });
    };

    Client.prototype.configureService = function (serviceName, data, callback) {
        post('/api/v1/services/' + serviceName, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.restartService = function (serviceName, callback) {
        post('/api/v1/services/' + serviceName + '/restart', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.rebuildService = function (serviceName, callback) {
        post('/api/v1/services/' + serviceName + '/rebuild', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getUsers = function (search, page, perPage, callback) {
        if (typeof search === 'function') {
            callback = search;
            search = '';
            page = 1;
            perPage = 5000;
        }

        var config = {
            params: {
                page: page,
                per_page: perPage
            }
        };

        if (search) config.params.search = search;

        get('/api/v1/users', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.users);
        });
    };

    Client.prototype.getUser = function (userId, callback) {
        get('/api/v1/users/' + userId, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getGroups = function (callback) {
        get('/api/v1/groups', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.groups);
        });
    };

    Client.prototype.setGroups = function (userId, groupIds, callback) {
        put('/api/v1/users/' + userId + '/groups', { groupIds: groupIds }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getGroup = function (groupId, callback) {
        get('/api/v1/groups/' + groupId, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.createGroup = function (name, callback) {
        var data = {
            name: name
        };

        post('/api/v1/groups', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.updateGroup = function (id, name, callback) {
        var data = {
            name: name
        };

        post('/api/v1/groups/' + id, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setGroupMembers = function (id, userIds, callback) {
        var data = {
            userIds: userIds

        };

        put('/api/v1/groups/' + id + '/members', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.removeGroup = function (groupId, callback) {
        var config = {
            data: {},
            headers: {
                'Content-Type': 'application/json'
            }
        };

        del('/api/v1/groups/' + groupId, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getApp = function (appId, callback) {
        var that = this;

        get('/api/v1/apps/' + appId, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            that._appPostProcess(data);

            callback(null, data);
        });
    };

    Client.prototype.getAppWithTask = function (appId, callback) {
        var that = this;

        this.getApp(appId, function (error, app) {
            if (error) return callback(error);

            if (!app.taskId) return callback(null, app);

            that.getTask(app.taskId, function (error, task) {
                if (error) return callback(error);

                if (task) {
                    app.progress = task.percent;
                    app.message = task.message;
                    app.taskMinutesActive = moment.duration(moment.utc().diff(moment.utc(task.creationTime))).asMinutes();
                } else {
                    app.progress = 0;
                    app.message = '';
                    app.taskMinutesActive = 0;
                }

                callback(null, app);
            });
        });
    };

    Client.prototype.getCachedAppSync = function (appId) {
        var appFound = null;
        this._installedApps.some(function (app) {
            if (app.id === appId) {
                appFound = app;
                return true;
            } else {
                return false;
            }
        });

        return appFound;
    };

    Client.prototype.createInvite = function (userId, callback) {
        post('/api/v1/users/' + userId + '/create_invite', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.sendInvite = function (userId, callback) {
        post('/api/v1/users/' + userId + '/send_invite', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.disableTwoFactorAuthenticationByUserId = function (userId, callback) {
        post('/api/v1/users/' + userId + '/twofactorauthentication_disable', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setup = function (data, callback) {
        post('/api/v1/cloudron/setup', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.createAdmin = function (data, callback) {
        var that = this;

        post('/api/v1/cloudron/activate', data, null, function (error, result, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, result));

            that.setToken(result.token);
            that.setUserInfo({ username: data.username, email: data.email, admin: true, twoFactorAuthenticationEnabled: false, source: '', avatarUrl: null });

            callback(null, result.activated);
        });
    };

    Client.prototype.getTokens = function (callback) {
        get('/api/v1/tokens/', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.tokens);
        });
    };

    Client.prototype.createToken = function (name, callback) {
        var data = {
            name: name
        };

        post('/api/v1/tokens', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    // FIXME clashes with existing getToken()
    // Client.prototype.getToken = function (id, callback) {
    //     get('/api/v1/tokens/' + id, null, function (error, data, status) {
    //         if (error) return callback(error);
    //         if (status !== 200) return callback(new ClientError(status, data));

    //         callback(null, data.token);
    //     });
    // };

    Client.prototype.delToken = function (tokenId, callback) {
        del('/api/v1/tokens/' + tokenId, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.addAppPassword = function (identifier, name, callback) {
        var data = {
            identifier: identifier,
            name: name
        };

        post('/api/v1/app_passwords', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getAppPasswords = function (callback) {
        get('/api/v1/app_passwords', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.delAppPassword = function (id, callback) {
        del('/api/v1/app_passwords/' + id, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.update = function (options, callback) {
        var data = {
            skipBackup: !!options.skipBackup
        };

        post('/api/v1/cloudron/update', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.isRebootRequired = function (callback) {
        get('/api/v1/cloudron/reboot', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.rebootRequired);
        });
    };

    Client.prototype.reboot = function (callback) {
        post('/api/v1/cloudron/reboot', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setCertificate = function (certificateFile, keyFile, callback) {
        var data = {
            cert: certificateFile,
            key: keyFile
        };

        post('/api/v1/settings/certificate', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.disks = function (callback) {
        get('/api/v1/cloudron/disks', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.memory = function (callback) {
        get('/api/v1/cloudron/memory', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.graphs = function (targets, from, options, callback) {
        // if we have a lot of apps, targets can be very large. node will just disconnect since it exceeds header size
        var size = 10, chunks = [];
        for (var i = 0; i < targets.length; i += size) {
            chunks.push(targets.slice(i, i+size));
        }

        var result = [];
        async.eachSeries(chunks, function (chunk, iteratorCallback) {
            var config = {
                params: {
                    target: chunk,
                    format: 'json',
                    from: from,
                    until: 'now'
                }
            };

            if (options.noNullPoints) config.params.noNullPoints = true;

            get('/api/v1/cloudron/graphs', config, function (error, data, status) {
                if (error) return iteratorCallback(error);
                if (status !== 200) return iteratorCallback(new ClientError(status, data));

                // the datapoint returned here is an [value, timestamp]
                result = result.concat(data);
                iteratorCallback(null);
            });
        }, function iteratorDone(error) {
            callback(error, result);
        });
    };

    Client.prototype.createTicket = function (ticket, callback) {
        // just to be eplicit here
        var data = {
            enableSshSupport: !!ticket.enableSshSupport,
            type: ticket.type,
            subject: ticket.subject,
            description: ticket.description,
            appId: ticket.appId || undefined,
            altEmail: ticket.altEmail || undefined
        };

        post('/api/v1/support/ticket', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.createUser = function (user, callback) {
        var data = {
            email: user.email,
            displayName: user.displayName,
            role: user.role
        };

        if (user.username !== null) data.username = user.username;

        post('/api/v1/users', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.updateUser = function (user, callback) {
        var data = {
            email: user.email,
            displayName: user.displayName,
            fallbackEmail: user.fallbackEmail,
            active: user.active,
            role: user.role
        };

        post('/api/v1/users/' + user.id, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.changeOwnership = function (userId, callback) {
        post('/api/v1/users/' + userId + '/make_owner', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.removeUser = function (userId, callback) {
        var config = {
            data: {},
            headers: {
                'Content-Type': 'application/json'
            }
        };

        del('/api/v1/users/' + userId, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.updateProfile = function (data, callback) {
        post('/api/v1/profile', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.clearAvatar = function (callback) {
        del('/api/v1/profile/avatar', {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.changeAvatar = function (avatarFile, callback) {
        var fd = new FormData();
        fd.append('avatar', avatarFile);

        var config = {
            headers: { 'Content-Type': undefined },
            transformRequest: angular.identity
        };

        post('/api/v1/profile/avatar', fd, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.changePassword = function (currentPassword, newPassword, callback) {
        var data = {
            password: currentPassword,
            newPassword: newPassword
        };

        post('/api/v1/profile/password', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setTwoFactorAuthenticationSecret = function (callback) {
        var data = {};

        post('/api/v1/profile/twofactorauthentication_secret', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.enableTwoFactorAuthentication = function (totpToken, callback) {
        var data = {
            totpToken: totpToken
        };

        post('/api/v1/profile/twofactorauthentication_enable', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.disableTwoFactorAuthentication = function (password, callback) {
        var data = {
            password: password
        };

        post('/api/v1/profile/twofactorauthentication_disable', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.startExternalLdapSync = function (callback) {
        post('/api/v1/cloudron/sync_external_ldap', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.setUserActive = function (userId, active, callback) {
        var data = {
            active: active
        };

        post('/api/v1/users/' + userId + '/active', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.refreshUserInfo = function (callback) {
        var that = this;

        callback = typeof callback === 'function' ? callback : function () {};

        this.userInfo(function (error, result) {
            if (error) return callback(error);

            that.setUserInfo(result);
            callback(null);
        });
    };

    Client.prototype.refreshConfig = function (callback) {
        var that = this;

        callback = typeof callback === 'function' ? callback : function () {};

        this.config(function (error, result) {
            if (error) return callback(error);

            that.getUpdateInfo(function (error, info) { // note: non-admin users may get access denied for this
                if (!error) result.update = info.update; // attach update information to config object

                that.setConfig(result);
                callback(null);
            });
        });
    };

    Client.prototype.refreshAvailableLanguages = function (callback) {
        var that = this;

        get('/api/v1/cloudron/languages', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            angular.copy(data.languages, that._availableLanguages);

            callback(null, data.languages);
        });
    };

    Client.prototype._appPostProcess = function (app) {
        // calculate the icon paths
        app.iconUrl = app.iconUrl ? (this.apiOrigin + app.iconUrl + '?access_token=' + token + '&ts=' + app.ts) : null;

        // amend the post install confirm state
        app.pendingPostInstallConfirmation = !!localStorage['confirmPostInstall_' + app.id];

        if (app.manifest.description) { // can be empty for dev apps
            var tmp = app.manifest.description.match(/\<upstream\>(.*)\<\/upstream\>/i);
            app.upstreamVersion = (tmp && tmp[1]) ? tmp[1] : '';
        } else {
            app.upstreamVersion = '';
        }

        if (!app.manifest.title) app.manifest.title = 'Untitled';

        if (app.manifest.postInstallMessage) {
            var text= app.manifest.postInstallMessage;
            // we chose - because underscore has special meaning in markdown
            text = text.replace(/\$CLOUDRON-APP-LOCATION/g, app.location);
            text = text.replace(/\$CLOUDRON-APP-DOMAIN/g, app.domain);
            text = text.replace(/\$CLOUDRON-APP-FQDN/g, app.fqdn);
            text = text.replace(/\$CLOUDRON-APP-ORIGIN/g, 'https://' + app.fqdn);
            text = text.replace(/\$CLOUDRON-API-DOMAIN/g, this._config.adminFqdn);
            text = text.replace(/\$CLOUDRON-API-ORIGIN/g, 'https://' + this._config.adminFqdn);
            text = text.replace(/\$CLOUDRON-USERNAME/g, this._userInfo.username);
            text = text.replace(/\$CLOUDRON-APP-ID/g, app.id);

            // [^] matches even newlines. '?' makes it non-greedy
            if (app.sso) text = text.replace(/<nosso>[^]*?<\/nosso>/g, '');
            else text = text.replace(/<sso>[^]*?<\/sso>/g, '');

            app.manifest.postInstallMessage = text;
        }

        return app;
    };

    function binarySearch(array, pred) {
        var lo = -1, hi = array.length;
        while (1 + lo !== hi) {
            var mi = lo + ((hi - lo) >> 1);
            if (pred(array[mi])) {
                hi = mi;
            } else {
                lo = mi;
            }
        }
        return hi;
    }

    Client.prototype._updateAppCache = function (app) {
        var tmp = {};
        angular.copy(app, tmp);

        var foundIndex = this._installedApps.findIndex(function (a) { return a.id === app.id; });

        // we replace new data into the existing reference to keep angular bindings
        if (foundIndex !== -1) {
            angular.copy(tmp, this._installedApps[foundIndex]);
        } else {
            this._installedApps.push(tmp);
        }

        // add reference to object map with appId keys
        this._installedAppsById[app.id] = this._installedApps[foundIndex];

        // TODO this not very elegant
        // update app tags
        tmp = this._installedApps
            .map(function (app) { return app.tags || []; })                     // return array of arrays
            .reduce(function (a, i) { return a.concat(i); }, [])                // merge all arrays into one
            .filter(function (v, i, self) { return self.indexOf(v) === i; })    // filter duplicates
            .sort(function (a, b) { return a.localeCompare(b); });              // sort

        // keep tag array references
        angular.copy(tmp, this._appTags);
    };

    Client.prototype.refreshInstalledApps = function (callback) {
        callback = callback || function (error) { if (error) console.error(error); };
        var that = this;

        this.getApps(function (error, apps) {
            if (error) return callback(error);

            async.eachLimit(apps, 20, function (app, iteratorCallback) {
                app.ssoAuth = (app.manifest.addons['ldap'] || app.manifest.addons['proxyAuth']) && app.sso;

                // only fetch if we have permissions
                if (!that._userInfo.isAtLeastAdmin) {
                    app.progress = 0;
                    app.message = '';
                    app.taskMinutesActive = 0;

                    that._updateAppCache(app);

                    return iteratorCallback();
                }

                var getTaskFunc = app.taskId ? that.getTask.bind(null, app.taskId) : function (next) { return next(); };
                getTaskFunc(function (error, task) {
                    if (error) return iteratorCallback(error);

                    if (task) {
                        app.progress = task.percent;
                        app.message = task.message;
                        app.taskMinutesActive = moment.duration(moment.utc().diff(moment.utc(task.creationTime))).asMinutes();
                    } else {
                        app.progress = 0;
                        app.message = '';
                        app.taskMinutesActive = 0;
                    }

                    that._updateAppCache(app);

                    iteratorCallback();
                });
            }, function iteratorDone(error) {
                if (error) return callback(error);

                // filter out old apps, going backwards to allow splicing
                for (var i = that._installedApps.length - 1; i >= 0; --i) {
                    if (!apps.some(function (elem) { return (elem.id === that._installedApps[i].id); })) {
                        var removed = that._installedApps.splice(i, 1);
                        delete that._installedAppsById[removed[0].id];
                    }
                }

                callback(null);
            });
        });
    };

    Client.prototype.login = function () {
        this.setToken(null);

        window.location.href = '/login.html?returnTo=/' + encodeURIComponent(window.location.hash);
    };

    Client.prototype.logout = function () {
        var token = this.getToken();
        this.setToken(null);

        // invalidates the token
        window.location.href = client.apiOrigin + '/api/v1/cloudron/logout?access_token=' + token;
    };

    Client.prototype.uploadFile = function (appId, file, progressCallback, callback) {
        var fd = new FormData();
        fd.append('file', file);

        var config = {
            headers: { 'Content-Type': undefined },
            transformRequest: angular.identity,
            uploadEventHandlers: {
                progress: progressCallback
            }
        };

        post('/api/v1/apps/' + appId + '/upload?file=' + encodeURIComponent('/tmp/' + file.name), fd, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.checkDownloadableFile = function (appId, filePath, callback) {
        var config = {
            headers: { 'Content-Type': undefined }
        };

        head('/api/v1/apps/' + appId + '/download?file=' + encodeURIComponent(filePath), config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.sendTestMail = function (domain, to, callback) {
        var data = {
            to: to
        };

        post('/api/v1/mail/' + domain + '/send_test_mail', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    // Domains
    Client.prototype.getDomains = function (callback) {
        get('/api/v1/domains', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.domains);
        });
    };

    Client.prototype.getDomain = function (domain, callback) {
        get('/api/v1/domains/' + domain, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.checkDNSRecords = function (domain, subdomain, callback) {
        get('/api/v1/domains/' + domain + '/dns_check?subdomain=' + subdomain, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.addDomain = function (domain, zoneName, provider, config, fallbackCertificate, tlsConfig, wellKnown, callback) {
        var data = {
            domain: domain,
            provider: provider,
            config: config,
            tlsConfig: tlsConfig,
            wellKnown: wellKnown
        };
        if (zoneName) data.zoneName = zoneName;
        var that = this;

        if (fallbackCertificate) data.fallbackCertificate = fallbackCertificate;

        // hack until we fix the domains.js
        post('/api/v1/domains', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback();
        });
    };

    Client.prototype.updateDomain = function (domain, zoneName, provider, config, fallbackCertificate, tlsConfig, wellKnown, callback) {
        var data = {
            provider: provider,
            config: config,
            tlsConfig: tlsConfig,
            wellKnown: wellKnown
        };
        if (zoneName) data.zoneName = zoneName;
        var that = this;

        if (fallbackCertificate) data.fallbackCertificate = fallbackCertificate;

        put('/api/v1/domains/' + domain, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            that.setDnsRecords({ domain: domain, type: 'mail' }, callback); // this is done so that an out-of-sync dkim key can be synced
        });
    };

    Client.prototype.renewCerts = function (callback) {
        post('/api/v1/cloudron/renew_certs', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.removeDomain = function (domain, callback) {
        var config = {
            data: {
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };

        del('/api/v1/domains/' + domain, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.prepareDashboardDomain = function (domain, callback) {
        var data = {
            domain: domain
        };

        post('/api/v1/cloudron/prepare_dashboard_domain', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.setDashboardDomain = function (domain, callback) {
        var data = {
            domain: domain
        };

        post('/api/v1/cloudron/set_dashboard_domain', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    // Email
    Client.prototype.getMailEventLogs = function (search, types, page, perPage, callback) {
        var config = {
            params: {
                page: page,
                types: types,
                per_page: perPage,
                search: search
            }
        };

        get('/api/v1/mailserver/eventlog', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
                callback(null, data.eventlogs);
        });
    };

    Client.prototype.getMailUsage = function (domain, callback) {
        var config = {
            params: {
                domain: domain
            }
        };

        get('/api/v1/mailserver/usage', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.usage);
        });
    };

    Client.prototype.getMailLocation = function (callback) {
        var config = {};

        get('/api/v1/mailserver/location', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data); // { subdomain, domain }
        });
    };

    Client.prototype.setMailLocation = function (subdomain, domain, callback) {
        post('/api/v1/mailserver/location', { subdomain: subdomain, domain: domain }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, { taskId: data.taskId });
        });
    };

    Client.prototype.getMaxEmailSize = function (callback) {
        var config = {};

        get('/api/v1/mailserver/max_email_size', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.size);
        });
    };

    Client.prototype.setMaxEmailSize = function (size, callback) {
        post('/api/v1/mailserver/max_email_size', { size: size }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getSolrConfig = function (callback) {
        var config = {};

        get('/api/v1/mailserver/solr_config', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.setSolrConfig = function (enabled, callback) {
        post('/api/v1/mailserver/solr_config', { enabled: enabled }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getSpamAcl = function (callback) {
        var config = {};

        get('/api/v1/mailserver/spam_acl', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.setSpamAcl = function (acl, callback) {
        post('/api/v1/mailserver/spam_acl', { whitelist: acl.whitelist, blacklist: acl.blacklist }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getSpamCustomConfig = function (callback) {
        var config = {};

        get('/api/v1/mailserver/spam_custom_config', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.config);
        });
    };

    Client.prototype.setSpamCustomConfig = function (config, callback) {
        post('/api/v1/mailserver/spam_custom_config', { config: config }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getMailConfigForDomain = function (domain, callback) {
        get('/api/v1/mail/' + domain, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.enableMailForDomain = function (domain, enabled, callback) {
        post('/api/v1/mail/' + domain + '/enable', { enabled: enabled }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.setDnsRecords = function (options, callback) {
        post('/api/v1/cloudron/sync_dns', options, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data.taskId);
        });
    };

    Client.prototype.getMailStatusForDomain = function (domain, callback) {
        get('/api/v1/mail/' + domain + '/status', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setMailRelay = function (domain, data, callback) {
        post('/api/v1/mail/' + domain + '/relay', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.setMailBanner = function (domain, data, callback) {
        post('/api/v1/mail/' + domain + '/banner', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.setCatchallAddresses = function (domain, addresses, callback) {
        post('/api/v1/mail/' + domain + '/catch_all', { addresses: addresses }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.setMailFromValidation = function (domain, enabled, callback) {
        post('/api/v1/mail/' + domain + '/mail_from_validation', { enabled: enabled }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    // Mailboxes
    Client.prototype.getMailboxCount = function (domain, callback) {
        get('/api/v1/mail/' + domain + '/mailbox_count', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.count);
        });
    };

    Client.prototype.listMailboxes = function (domain, search, page, perPage, callback) {
        var config = {
            params: {
                search: search,
                page: page,
                per_page: perPage
            }
        };

        get('/api/v1/mail/' + domain + '/mailboxes', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.mailboxes);
        });
    };

    Client.prototype.getMailbox = function (domain, name, callback) {
        get('/api/v1/mail/' + domain + '/mailboxes/' + name, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.mailbox);
        });
    };

    Client.prototype.addMailbox = function (domain, name, ownerId, ownerType, callback) {
        var data = {
            name: name,
            ownerId: ownerId,
            ownerType: ownerType,
            active: true
        };

        post('/api/v1/mail/' + domain + '/mailboxes', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.updateMailbox = function (domain, name, ownerId, ownerType, active, callback) {
        var data = {
            ownerId: ownerId,
            ownerType: ownerType,
            active: active
        };

        post('/api/v1/mail/' + domain + '/mailboxes/' + name, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.removeMailbox = function (domain, name, deleteMails, callback) {
        var config = {
            data: {
                deleteMails: deleteMails
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };

        del('/api/v1/mail/' + domain + '/mailboxes/' + name, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getAliases = function (name, domain, callback) {
        var config = {
            params: {
                page: 1,
                per_page: 1000
            }
        };

        get('/api/v1/mail/' + domain + '/mailboxes/' + name + '/aliases', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.aliases);
        });
    };

    Client.prototype.setAliases = function (name, domain, aliases, callback) {
        var data = {
            aliases: aliases
        };

        put('/api/v1/mail/' + domain + '/mailboxes/' + name + '/aliases', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.listMailingLists = function (domain, search, page, perPage, callback) {
        var config = {
            params: {
                search: search,
                page: page,
                per_page: perPage
            }
        };

        get('/api/v1/mail/' + domain + '/lists', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.lists);
        });
    };

    Client.prototype.getMailingList = function (domain, name, callback) {
        get('/api/v1/mail/' + domain + '/lists/' + name, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.list);
        });
    };

    Client.prototype.addMailingList = function (domain, name, members, membersOnly, callback) {
        var data = {
            name: name,
            members: members,
            membersOnly: membersOnly,
            active: true
        };

        post('/api/v1/mail/' + domain + '/lists', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.updateMailingList = function (domain, name, members, membersOnly, active, callback) {
        var data = {
            members: members,
            membersOnly: membersOnly,
            active: active
        };

        post('/api/v1/mail/' + domain + '/lists/' + name, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.removeMailingList = function (domain, name, callback) {
        del('/api/v1/mail/' + domain + '/lists/' + name, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    // Volumes
    Client.prototype.getVolumes = function (callback) {
        get('/api/v1/volumes', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.volumes);
        });
    };

    Client.prototype.getVolume = function (volume, callback) {
        get('/api/v1/volumes/' + volume, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getVolumeStatus = function (volume, callback) {
        get('/api/v1/volumes/' + volume + '/status', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.addVolume = function (name, mountType, hostPath, mountOptions, callback) {
        var data = {
            name: name,
            mountType: mountType,
            mountOptions: mountOptions
        };
        if (hostPath) data.hostPath = hostPath;

        var that = this;

        post('/api/v1/volumes', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data.id);
        });
    };

    Client.prototype.updateVolume = function (volumeId, mountType, mountOptions, callback) {
        var data = {
            mountType: mountType,
            mountOptions: mountOptions
        };

        var that = this;

        post('/api/v1/volumes/' + volumeId, data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback();
        });
    };

    Client.prototype.removeVolume = function (volume, callback) {
        var config = {
            data: {
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };

        del('/api/v1/volumes/' + volume, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getAppstoreUserToken = function (callback) {
        post('/api/v1/appstore/user_token', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data.accessToken);
        });
    };

    // This will change the location
    Client.prototype.openSubscriptionSetup = function (subscription) {
        // we only allow the owner to do so
        if (!this._userInfo.isAtLeastOwner) return;

        // basically the user has not setup appstore account yet
        if (!subscription.plan) return window.location.href = '/#/appstore';

        var that = this;

        var email = subscription.emailEncoded;
        var cloudronId = subscription.cloudronId;

        if (!this._userInfo.isAtLeastOwner) return window.location.href = that.getConfig().webServerOrigin + '/console.html#/userprofile?view=subscriptions&email=' + email + '&cloudronId=' + cloudronId;

        this.getAppstoreUserToken(function (error, token) {
            if (error) console.error('Unable to get appstore user token.', error);

            var url = that.getConfig().webServerOrigin + '/console.html#/userprofile?view=subscriptions&email=' + email + '&token=' + token;

            // Only open the subscription setup dialog when no subscription exists
            if (!subscription.plan || subscription.plan.id === 'free') url += '&cloudronId=' + cloudronId

            window.location.href = url;
        });
    };

    Client.prototype.getAppstoreAppByIdAndVersion = function (appId, version, callback) {
        var url = '/api/v1/appstore/apps/' + appId;
        if (version && version !== 'latest') url += '/versions/' + version;

        get(url, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getAppstoreApps = function (callback) {
        var that = this;

        get('/api/v1/appstore/apps', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            angular.copy(data.apps, that._appstoreAppCache);

            return callback(null, that._appstoreAppCache);
        });
    };

    Client.prototype.getAppstoreAppsFast = function (callback) {
        if (this._appstoreAppCache.length !== 0) return callback(null, this._appstoreAppCache);

        this.getAppstoreApps(callback);
    };

    Client.prototype.getSubscription = function (callback) {
        if (!this._userInfo.isAtLeastAdmin) return callback(new Error('Not allowed'));

        get('/api/v1/appstore/subscription', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            // just some helper property, since angular bindings cannot dot his easily
            data.emailEncoded = encodeURIComponent(data.email);

            callback(null, data); // { email, plan: { id, name }, cancel_at, status }
        });
    };

    Client.prototype.registerCloudron = function (email, password, totpToken, signup, purpose, callback) {
        var data = {
            email: email,
            password: password,
            signup: signup,
            purpose: purpose
        };

        if (totpToken) data.totpToken = totpToken;

        post('/api/v1/appstore/register_cloudron', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    // FileManager API
    // mode can be 'download', 'open', 'link' or 'data'
    Client.prototype.filesGet = function (id, type, path, mode, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        if (mode === 'download') {
            window.open(client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=true&access_token=' + token);
            callback(null);
        } else if (mode === 'open') {
            window.open(client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=false&access_token=' + token);
            callback(null);
        } else if (mode === 'link') {
            callback(null, client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=false&access_token=' + token);
        } else {
            function responseHandler(data, headers, status) {
                if (headers()['content-type'] && headers()['content-type'].indexOf('application/json') !== -1) return JSON.parse(data);
                return data;
            }

            get('/api/v1/' + objpath + '/files/' + path, { transformResponse: responseHandler }, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                callback(null, data);
            });
        }
    };

    Client.prototype.filesRemove = function (id, type, path, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        del('/api/v1/' + objpath + '/files/' + path, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesExtract = function (id, type, path, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        put('/api/v1/' + objpath + '/files/' + path, { action: 'extract' }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesChown = function (id, type, path, uid, recursive, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        put('/api/v1/' + objpath + '/files/' + path, { action: 'chown', uid: uid, recursive: recursive }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesRename = function (id, type, path, newPath, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        put('/api/v1/' + objpath + '/files/' + path, { action: 'rename', newFilePath: decodeURIComponent(newPath) }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCopy = function (id, type, path, newPath, callback) {
        var that = this;

        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        put('/api/v1/' + objpath + '/files/' + path, { action: 'copy', newFilePath: decodeURIComponent(newPath) }, {}, function (error, data, status) {
            if (error && error.statusCode === 409) return that.filesCopy(id, type, path, newPath + '-copy', callback);
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCreateDirectory = function (id, type, path, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        post('/api/v1/' + objpath + '/files/' + path, { directory: decodeURIComponent(path) }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCreateFile = function (id, type, path, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        post('/api/v1/' + objpath + '/files/' + path, {}, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesUpload = function (id, type, path, file, overwrite, progressHandler, callback) {
        var objpath = (type === 'app' ? 'apps/' : 'volumes/') + id;

        var fd = new FormData();
        fd.append('file', file);

        if (overwrite) fd.append('overwrite', 'true');

        function done(error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        }

        $http({
            url: client.apiOrigin + '/api/v1/' + objpath + '/files/' + path,
            method: 'POST',
            data: fd,
            transformRequest: angular.identity,
            headers: {
                'Content-Type': undefined,
                Authorization: 'Bearer ' + token
            },

            uploadEventHandlers: {
                progress: function (e) {
                    progressHandler(e.loaded);
                }
            }
        }).success(defaultSuccessHandler(done)).error(defaultErrorHandler(done));
    };

    client = new Client();
    return client;
}]);

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNldHVwZG5zLmpzIiwiY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsQ0NsVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoic2V0dXBkbnMuanMiLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCc7XG5cbi8qIGdsb2JhbCAkLCB0bGQsIGFuZ3VsYXIsIENsaXBib2FyZCAqL1xuXG4vLyBjcmVhdGUgbWFpbiBhcHBsaWNhdGlvbiBtb2R1bGVcbnZhciBhcHAgPSBhbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nLCBbJ3Bhc2NhbHByZWNodC50cmFuc2xhdGUnLCAnbmdDb29raWVzJywgJ2FuZ3VsYXItbWQ1JywgJ3VpLW5vdGlmaWNhdGlvbicsICd1aS5ib290c3RyYXAnXSk7XG5cbmFwcC5maWx0ZXIoJ3pvbmVOYW1lJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoZG9tYWluKSB7XG4gICAgICAgIHJldHVybiB0bGQuZ2V0RG9tYWluKGRvbWFpbik7XG4gICAgfTtcbn0pO1xuXG5hcHAuY29udHJvbGxlcignU2V0dXBETlNDb250cm9sbGVyJywgWyckc2NvcGUnLCAnJGh0dHAnLCAnJHRpbWVvdXQnLCAnQ2xpZW50JywgZnVuY3Rpb24gKCRzY29wZSwgJGh0dHAsICR0aW1lb3V0LCBDbGllbnQpIHtcbiAgICB2YXIgc2VhcmNoID0gZGVjb2RlVVJJQ29tcG9uZW50KHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpLnNsaWNlKDEpLnNwbGl0KCcmJykubWFwKGZ1bmN0aW9uIChpdGVtKSB7IHJldHVybiBpdGVtLnNwbGl0KCc9Jyk7IH0pLnJlZHVjZShmdW5jdGlvbiAobywgaykgeyBvW2tbMF1dID0ga1sxXTsgcmV0dXJuIG87IH0sIHt9KTtcblxuICAgICRzY29wZS5zdGF0ZSA9IG51bGw7IC8vICdpbml0aWFsaXplZCcsICd3YWl0aW5nRm9yRG5zU2V0dXAnLCAnd2FpdGluZ0ZvckJveCdcbiAgICAkc2NvcGUuZXJyb3IgPSB7fTtcbiAgICAkc2NvcGUucHJvdmlkZXIgPSAnJztcbiAgICAkc2NvcGUuc2hvd0ROU1NldHVwID0gZmFsc2U7XG4gICAgJHNjb3BlLmluc3RhbmNlSWQgPSAnJztcbiAgICAkc2NvcGUuaXNEb21haW4gPSBmYWxzZTtcbiAgICAkc2NvcGUuaXNTdWJkb21haW4gPSBmYWxzZTtcbiAgICAkc2NvcGUuYWR2YW5jZWRWaXNpYmxlID0gZmFsc2U7XG4gICAgJHNjb3BlLndlYlNlcnZlck9yaWdpbiA9ICcnO1xuICAgICRzY29wZS5jbGlwYm9hcmREb25lID0gZmFsc2U7XG4gICAgJHNjb3BlLnNlYXJjaCA9IHdpbmRvdy5sb2NhdGlvbi5zZWFyY2g7XG4gICAgJHNjb3BlLnNldHVwVG9rZW4gPSAnJztcblxuICAgICRzY29wZS50bHNQcm92aWRlciA9IFtcbiAgICAgICAgeyBuYW1lOiAnTGV0XFwncyBFbmNyeXB0IFByb2QnLCB2YWx1ZTogJ2xldHNlbmNyeXB0LXByb2QnIH0sXG4gICAgICAgIHsgbmFtZTogJ0xldFxcJ3MgRW5jcnlwdCBQcm9kIC0gV2lsZGNhcmQnLCB2YWx1ZTogJ2xldHNlbmNyeXB0LXByb2Qtd2lsZGNhcmQnIH0sXG4gICAgICAgIHsgbmFtZTogJ0xldFxcJ3MgRW5jcnlwdCBTdGFnaW5nJywgdmFsdWU6ICdsZXRzZW5jcnlwdC1zdGFnaW5nJyB9LFxuICAgICAgICB7IG5hbWU6ICdMZXRcXCdzIEVuY3J5cHQgU3RhZ2luZyAtIFdpbGRjYXJkJywgdmFsdWU6ICdsZXRzZW5jcnlwdC1zdGFnaW5nLXdpbGRjYXJkJyB9LFxuICAgICAgICB7IG5hbWU6ICdTZWxmLVNpZ25lZCcsIHZhbHVlOiAnZmFsbGJhY2snIH0sIC8vIHRoaXMgaXMgbm90ICdDdXN0b20nIGJlY2F1c2Ugd2UgZG9uJ3QgYWxsb3cgdXNlciB0byB1cGxvYWQgY2VydHMgZHVyaW5nIHNldHVwIHBoYXNlXG4gICAgXTtcblxuICAgICRzY29wZS5zeXNpbmZvID0ge1xuICAgICAgICBwcm92aWRlcjogJ2dlbmVyaWMnLFxuICAgICAgICBpcDogJycsXG4gICAgICAgIGlmbmFtZTogJydcbiAgICB9O1xuXG4gICAgJHNjb3BlLnN5c2luZm9Qcm92aWRlciA9IFtcbiAgICAgICAgeyBuYW1lOiAnUHVibGljIElQJywgdmFsdWU6ICdnZW5lcmljJyB9LFxuICAgICAgICB7IG5hbWU6ICdTdGF0aWMgSVAgQWRkcmVzcycsIHZhbHVlOiAnZml4ZWQnIH0sXG4gICAgICAgIHsgbmFtZTogJ05ldHdvcmsgSW50ZXJmYWNlJywgdmFsdWU6ICduZXR3b3JrLWludGVyZmFjZScgfVxuICAgIF07XG5cbiAgICAkc2NvcGUucHJldHR5U3lzaW5mb1Byb3ZpZGVyTmFtZSA9IGZ1bmN0aW9uIChwcm92aWRlcikge1xuICAgICAgICBzd2l0Y2ggKHByb3ZpZGVyKSB7XG4gICAgICAgIGNhc2UgJ2dlbmVyaWMnOiByZXR1cm4gJ1B1YmxpYyBJUCc7XG4gICAgICAgIGNhc2UgJ2ZpeGVkJzogcmV0dXJuICdTdGF0aWMgSVAgQWRkcmVzcyc7XG4gICAgICAgIGNhc2UgJ25ldHdvcmstaW50ZXJmYWNlJzogcmV0dXJuICdOZXR3b3JrIEludGVyZmFjZSc7XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybiAnVW5rbm93bic7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJHNjb3BlLm5lZWRzUG9ydDgwID0gZnVuY3Rpb24gKGRuc1Byb3ZpZGVyLCB0bHNQcm92aWRlcikge1xuICAgICAgICByZXR1cm4gKChkbnNQcm92aWRlciA9PT0gJ21hbnVhbCcgfHwgZG5zUHJvdmlkZXIgPT09ICdub29wJyB8fCBkbnNQcm92aWRlciA9PT0gJ3dpbGRjYXJkJykgJiZcbiAgICAgICAgICAgICh0bHNQcm92aWRlciA9PT0gJ2xldHNlbmNyeXB0LXByb2QnIHx8IHRsc1Byb3ZpZGVyID09PSAnbGV0c2VuY3J5cHQtc3RhZ2luZycpKTtcbiAgICB9O1xuXG4gICAgLy8gSWYgd2UgbWlncmF0ZSB0aGUgYXBpIG9yaWdpbiB3ZSBoYXZlIHRvIHBvbGwgdGhlIG5ldyBsb2NhdGlvblxuICAgIGlmIChzZWFyY2guYWRtaW5fZnFkbikgQ2xpZW50LmFwaU9yaWdpbiA9ICdodHRwczovLycgKyBzZWFyY2guYWRtaW5fZnFkbjtcblxuICAgICRzY29wZS4kd2F0Y2goJ2Ruc0NyZWRlbnRpYWxzLmRvbWFpbicsIGZ1bmN0aW9uIChuZXdWYWwpIHtcbiAgICAgICAgaWYgKCFuZXdWYWwpIHtcbiAgICAgICAgICAgICRzY29wZS5pc0RvbWFpbiA9IGZhbHNlO1xuICAgICAgICAgICAgJHNjb3BlLmlzU3ViZG9tYWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAoIXRsZC5nZXREb21haW4obmV3VmFsKSB8fCBuZXdWYWxbbmV3VmFsLmxlbmd0aC0xXSA9PT0gJy4nKSB7XG4gICAgICAgICAgICAkc2NvcGUuaXNEb21haW4gPSBmYWxzZTtcbiAgICAgICAgICAgICRzY29wZS5pc1N1YmRvbWFpbiA9IGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJHNjb3BlLmlzRG9tYWluID0gdHJ1ZTtcbiAgICAgICAgICAgICRzY29wZS5pc1N1YmRvbWFpbiA9IHRsZC5nZXREb21haW4obmV3VmFsKSAhPT0gbmV3VmFsO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBrZWVwIGluIHN5bmMgd2l0aCBkb21haW5zLmpzXG4gICAgJHNjb3BlLmRuc1Byb3ZpZGVyID0gW1xuICAgICAgICB7IG5hbWU6ICdBV1MgUm91dGU1MycsIHZhbHVlOiAncm91dGU1MycgfSxcbiAgICAgICAgeyBuYW1lOiAnQ2xvdWRmbGFyZScsIHZhbHVlOiAnY2xvdWRmbGFyZScgfSxcbiAgICAgICAgeyBuYW1lOiAnRGlnaXRhbE9jZWFuJywgdmFsdWU6ICdkaWdpdGFsb2NlYW4nIH0sXG4gICAgICAgIHsgbmFtZTogJ0dhbmRpIExpdmVETlMnLCB2YWx1ZTogJ2dhbmRpJyB9LFxuICAgICAgICB7IG5hbWU6ICdHb0RhZGR5JywgdmFsdWU6ICdnb2RhZGR5JyB9LFxuICAgICAgICB7IG5hbWU6ICdHb29nbGUgQ2xvdWQgRE5TJywgdmFsdWU6ICdnY2RucycgfSxcbiAgICAgICAgeyBuYW1lOiAnTGlub2RlJywgdmFsdWU6ICdsaW5vZGUnIH0sXG4gICAgICAgIHsgbmFtZTogJ05hbWUuY29tJywgdmFsdWU6ICduYW1lY29tJyB9LFxuICAgICAgICB7IG5hbWU6ICdOYW1lY2hlYXAnLCB2YWx1ZTogJ25hbWVjaGVhcCcgfSxcbiAgICAgICAgeyBuYW1lOiAnTmV0Y3VwJywgdmFsdWU6ICduZXRjdXAnIH0sXG4gICAgICAgIHsgbmFtZTogJ1Z1bHRyJywgdmFsdWU6ICd2dWx0cicgfSxcbiAgICAgICAgeyBuYW1lOiAnV2lsZGNhcmQnLCB2YWx1ZTogJ3dpbGRjYXJkJyB9LFxuICAgICAgICB7IG5hbWU6ICdNYW51YWwgKG5vdCByZWNvbW1lbmRlZCknLCB2YWx1ZTogJ21hbnVhbCcgfSxcbiAgICAgICAgeyBuYW1lOiAnTm8tb3AgKG9ubHkgZm9yIGRldmVsb3BtZW50KScsIHZhbHVlOiAnbm9vcCcgfVxuICAgIF07XG4gICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzID0ge1xuICAgICAgICBidXN5OiBmYWxzZSxcbiAgICAgICAgZG9tYWluOiAnJyxcbiAgICAgICAgYWNjZXNzS2V5SWQ6ICcnLFxuICAgICAgICBzZWNyZXRBY2Nlc3NLZXk6ICcnLFxuICAgICAgICBnY2Ruc0tleTogeyBrZXlGaWxlTmFtZTogJycsIGNvbnRlbnQ6ICcnIH0sXG4gICAgICAgIGRpZ2l0YWxPY2VhblRva2VuOiAnJyxcbiAgICAgICAgZ2FuZGlBcGlLZXk6ICcnLFxuICAgICAgICBjbG91ZGZsYXJlRW1haWw6ICcnLFxuICAgICAgICBjbG91ZGZsYXJlVG9rZW46ICcnLFxuICAgICAgICBjbG91ZGZsYXJlVG9rZW5UeXBlOiAnR2xvYmFsQXBpS2V5JyxcbiAgICAgICAgZ29kYWRkeUFwaUtleTogJycsXG4gICAgICAgIGdvZGFkZHlBcGlTZWNyZXQ6ICcnLFxuICAgICAgICBsaW5vZGVUb2tlbjogJycsXG4gICAgICAgIHZ1bHRyVG9rZW46ICcnLFxuICAgICAgICBuYW1lQ29tVXNlcm5hbWU6ICcnLFxuICAgICAgICBuYW1lQ29tVG9rZW46ICcnLFxuICAgICAgICBuYW1lY2hlYXBVc2VybmFtZTogJycsXG4gICAgICAgIG5hbWVjaGVhcEFwaUtleTogJycsXG4gICAgICAgIG5ldGN1cEN1c3RvbWVyTnVtYmVyOiAnJyxcbiAgICAgICAgbmV0Y3VwQXBpS2V5OiAnJyxcbiAgICAgICAgbmV0Y3VwQXBpUGFzc3dvcmQ6ICcnLFxuICAgICAgICBwcm92aWRlcjogJ3JvdXRlNTMnLFxuICAgICAgICB6b25lTmFtZTogJycsXG4gICAgICAgIHRsc0NvbmZpZzoge1xuICAgICAgICAgICAgcHJvdmlkZXI6ICdsZXRzZW5jcnlwdC1wcm9kLXdpbGRjYXJkJ1xuICAgICAgICB9XG4gICAgfTtcblxuICAgICRzY29wZS5zZXREZWZhdWx0VGxzUHJvdmlkZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBkbnNQcm92aWRlciA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlcjtcbiAgICAgICAgLy8gd2lsZGNhcmQgTEUgd29uJ3Qgd29yayB3aXRob3V0IGF1dG9tYXRlZCBETlNcbiAgICAgICAgaWYgKGRuc1Byb3ZpZGVyID09PSAnbWFudWFsJyB8fCBkbnNQcm92aWRlciA9PT0gJ25vb3AnIHx8IGRuc1Byb3ZpZGVyID09PSAnd2lsZGNhcmQnKSB7XG4gICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMudGxzQ29uZmlnLnByb3ZpZGVyID0gJ2xldHNlbmNyeXB0LXByb2QnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnRsc0NvbmZpZy5wcm92aWRlciA9ICdsZXRzZW5jcnlwdC1wcm9kLXdpbGRjYXJkJztcbiAgICAgICAgfVxuICAgIH07XG5cblxuICAgIGZ1bmN0aW9uIHJlYWRGaWxlTG9jYWxseShvYmosIGZpbGUsIGZpbGVOYW1lKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgICRzY29wZS4kYXBwbHkoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG9ialtmaWxlXSA9IG51bGw7XG4gICAgICAgICAgICAgICAgb2JqW2ZpbGVOYW1lXSA9IGV2ZW50LnRhcmdldC5maWxlc1swXS5uYW1lO1xuXG4gICAgICAgICAgICAgICAgdmFyIHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gICAgICAgICAgICAgICAgcmVhZGVyLm9ubG9hZCA9IGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQudGFyZ2V0IHx8ICFyZXN1bHQudGFyZ2V0LnJlc3VsdCkgcmV0dXJuIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byByZWFkIGxvY2FsIGZpbGUnKTtcbiAgICAgICAgICAgICAgICAgICAgb2JqW2ZpbGVdID0gcmVzdWx0LnRhcmdldC5yZXN1bHQ7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZWFkZXIucmVhZEFzVGV4dChldmVudC50YXJnZXQuZmlsZXNbMF0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2djZG5zS2V5RmlsZUlucHV0Jykub25jaGFuZ2UgPSByZWFkRmlsZUxvY2FsbHkoJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmdjZG5zS2V5LCAnY29udGVudCcsICdrZXlGaWxlTmFtZScpO1xuXG4gICAgJHNjb3BlLnNldERuc0NyZWRlbnRpYWxzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuYnVzeSA9IHRydWU7XG4gICAgICAgICRzY29wZS5lcnJvciA9IHt9O1xuXG4gICAgICAgIHZhciBwcm92aWRlciA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlcjtcblxuICAgICAgICB2YXIgY29uZmlnID0ge307XG5cbiAgICAgICAgaWYgKHByb3ZpZGVyID09PSAncm91dGU1MycpIHtcbiAgICAgICAgICAgIGNvbmZpZy5hY2Nlc3NLZXlJZCA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5hY2Nlc3NLZXlJZDtcbiAgICAgICAgICAgIGNvbmZpZy5zZWNyZXRBY2Nlc3NLZXkgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuc2VjcmV0QWNjZXNzS2V5O1xuICAgICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnZ2NkbnMnKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHZhciBzZXJ2aWNlQWNjb3VudEtleSA9IEpTT04ucGFyc2UoJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmdjZG5zS2V5LmNvbnRlbnQpO1xuICAgICAgICAgICAgICAgIGNvbmZpZy5wcm9qZWN0SWQgPSBzZXJ2aWNlQWNjb3VudEtleS5wcm9qZWN0X2lkO1xuICAgICAgICAgICAgICAgIGNvbmZpZy5jcmVkZW50aWFscyA9IHtcbiAgICAgICAgICAgICAgICAgICAgY2xpZW50X2VtYWlsOiBzZXJ2aWNlQWNjb3VudEtleS5jbGllbnRfZW1haWwsXG4gICAgICAgICAgICAgICAgICAgIHByaXZhdGVfa2V5OiBzZXJ2aWNlQWNjb3VudEtleS5wcml2YXRlX2tleVxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBpZiAoIWNvbmZpZy5wcm9qZWN0SWQgfHwgIWNvbmZpZy5jcmVkZW50aWFscyB8fCAhY29uZmlnLmNyZWRlbnRpYWxzLmNsaWVudF9lbWFpbCB8fCAhY29uZmlnLmNyZWRlbnRpYWxzLnByaXZhdGVfa2V5KSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignT25lIG9yIG1vcmUgZmllbGRzIGFyZSBtaXNzaW5nIGluIHRoZSBKU09OJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICRzY29wZS5lcnJvci5kbnNDcmVkZW50aWFscyA9ICdDYW5ub3QgcGFyc2UgR29vZ2xlIFNlcnZpY2UgQWNjb3VudCBLZXk6ICcgKyBlLm1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmJ1c3kgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICdkaWdpdGFsb2NlYW4nKSB7XG4gICAgICAgICAgICBjb25maWcudG9rZW4gPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuZGlnaXRhbE9jZWFuVG9rZW47XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICdnYW5kaScpIHtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5nYW5kaUFwaUtleTtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2dvZGFkZHknKSB7XG4gICAgICAgICAgICBjb25maWcuYXBpS2V5ID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmdvZGFkZHlBcGlLZXk7XG4gICAgICAgICAgICBjb25maWcuYXBpU2VjcmV0ID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmdvZGFkZHlBcGlTZWNyZXQ7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICdjbG91ZGZsYXJlJykge1xuICAgICAgICAgICAgY29uZmlnLmVtYWlsID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmNsb3VkZmxhcmVFbWFpbDtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5jbG91ZGZsYXJlVG9rZW47XG4gICAgICAgICAgICBjb25maWcudG9rZW5UeXBlID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmNsb3VkZmxhcmVUb2tlblR5cGU7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICdsaW5vZGUnKSB7XG4gICAgICAgICAgICBjb25maWcudG9rZW4gPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubGlub2RlVG9rZW47XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICd2dWx0cicpIHtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy52dWx0clRva2VuO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnbmFtZWNvbScpIHtcbiAgICAgICAgICAgIGNvbmZpZy51c2VybmFtZSA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5uYW1lQ29tVXNlcm5hbWU7XG4gICAgICAgICAgICBjb25maWcudG9rZW4gPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubmFtZUNvbVRva2VuO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnbmFtZWNoZWFwJykge1xuICAgICAgICAgICAgY29uZmlnLnRva2VuID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLm5hbWVjaGVhcEFwaUtleTtcbiAgICAgICAgICAgIGNvbmZpZy51c2VybmFtZSA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5uYW1lY2hlYXBVc2VybmFtZTtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ25ldGN1cCcpIHtcbiAgICAgICAgICAgIGNvbmZpZy5jdXN0b21lck51bWJlciA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5uZXRjdXBDdXN0b21lck51bWJlcjtcbiAgICAgICAgICAgIGNvbmZpZy5hcGlLZXkgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubmV0Y3VwQXBpS2V5O1xuICAgICAgICAgICAgY29uZmlnLmFwaVBhc3N3b3JkID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLm5ldGN1cEFwaVBhc3N3b3JkO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHRsc0NvbmZpZyA9IHtcbiAgICAgICAgICAgIHByb3ZpZGVyOiAkc2NvcGUuZG5zQ3JlZGVudGlhbHMudGxzQ29uZmlnLnByb3ZpZGVyLFxuICAgICAgICAgICAgd2lsZGNhcmQ6IGZhbHNlXG4gICAgICAgIH07XG4gICAgICAgIGlmICgkc2NvcGUuZG5zQ3JlZGVudGlhbHMudGxzQ29uZmlnLnByb3ZpZGVyLmluZGV4T2YoJy13aWxkY2FyZCcpICE9PSAtMSkge1xuICAgICAgICAgICAgdGxzQ29uZmlnLnByb3ZpZGVyID0gdGxzQ29uZmlnLnByb3ZpZGVyLnJlcGxhY2UoJy13aWxkY2FyZCcsICcnKTtcbiAgICAgICAgICAgIHRsc0NvbmZpZy53aWxkY2FyZCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgc3lzaW5mb0NvbmZpZyA9IHtcbiAgICAgICAgICAgIHByb3ZpZGVyOiAkc2NvcGUuc3lzaW5mby5wcm92aWRlclxuICAgICAgICB9O1xuICAgICAgICBpZiAoJHNjb3BlLnN5c2luZm8ucHJvdmlkZXIgPT09ICdmaXhlZCcpIHtcbiAgICAgICAgICAgIHN5c2luZm9Db25maWcuaXAgPSAkc2NvcGUuc3lzaW5mby5pcDtcbiAgICAgICAgfSBlbHNlIGlmICgkc2NvcGUuc3lzaW5mby5wcm92aWRlciA9PT0gJ25ldHdvcmstaW50ZXJmYWNlJykge1xuICAgICAgICAgICAgc3lzaW5mb0NvbmZpZy5pZm5hbWUgPSAkc2NvcGUuc3lzaW5mby5pZm5hbWU7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGRuc0NvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRvbWFpbjogJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmRvbWFpbixcbiAgICAgICAgICAgICAgICB6b25lTmFtZTogJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnpvbmVOYW1lLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyOiBwcm92aWRlcixcbiAgICAgICAgICAgICAgICBjb25maWc6IGNvbmZpZyxcbiAgICAgICAgICAgICAgICB0bHNDb25maWc6IHRsc0NvbmZpZ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN5c2luZm9Db25maWc6IHN5c2luZm9Db25maWcsXG4gICAgICAgICAgICBwcm92aWRlclRva2VuOiAkc2NvcGUuaW5zdGFuY2VJZCxcbiAgICAgICAgICAgIHNldHVwVG9rZW46ICRzY29wZS5zZXR1cFRva2VuXG4gICAgICAgIH07XG5cbiAgICAgICAgQ2xpZW50LnNldHVwKGRhdGEsIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmJ1c3kgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3Iuc3RhdHVzQ29kZSA9PT0gNDIyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwcm92aWRlciA9PT0gJ2FtaScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICRzY29wZS5lcnJvci5hbWkgPSBlcnJvci5tZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgJHNjb3BlLmVycm9yLnNldHVwID0gZXJyb3IubWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICRzY29wZS5lcnJvci5kbnNDcmVkZW50aWFscyA9IGVycm9yLm1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgd2FpdEZvckRuc1NldHVwKCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiB3YWl0Rm9yRG5zU2V0dXAoKSB7XG4gICAgICAgICRzY29wZS5zdGF0ZSA9ICd3YWl0aW5nRm9yRG5zU2V0dXAnO1xuXG4gICAgICAgIENsaWVudC5nZXRTdGF0dXMoZnVuY3Rpb24gKGVycm9yLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmICghZXJyb3IgJiYgIXN0YXR1cy5zZXR1cC5hY3RpdmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXN0YXR1cy5hZG1pbkZxZG4gfHwgc3RhdHVzLnNldHVwLmVycm9yTWVzc2FnZSkgeyAvLyBzZXR1cCByZXNldCBvciBlcnJvcmVkLiBzdGFydCBvdmVyXG4gICAgICAgICAgICAgICAgICAgICRzY29wZS5lcnJvci5zZXR1cCA9IHN0YXR1cy5zZXR1cC5lcnJvck1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgICAgICRzY29wZS5zdGF0ZSA9ICdpbml0aWFsaXplZCc7XG4gICAgICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHsgLy8gcHJvY2VlZCB0byBhY3RpdmF0aW9uXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvdy5sb2NhdGlvbi5ocmVmID0gJ2h0dHBzOi8vJyArIHN0YXR1cy5hZG1pbkZxZG4gKyAnL3NldHVwLmh0bWwnICsgKHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICRzY29wZS5tZXNzYWdlID0gc3RhdHVzLnNldHVwLm1lc3NhZ2U7XG5cbiAgICAgICAgICAgIHNldFRpbWVvdXQod2FpdEZvckRuc1NldHVwLCA1MDAwKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICAgICAgQ2xpZW50LmdldFN0YXR1cyhmdW5jdGlvbiAoZXJyb3IsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgLy8gRHVyaW5nIGRvbWFpbiBtaWdyYXRpb24sIHRoZSBib3ggY29kZSByZXN0YXJ0cyBhbmQgY2FuIHJlc3VsdCBpbiBnZXRTdGF0dXMoKSBmYWlsaW5nIHRlbXBvcmFyaWx5XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICAgICAgICAgICAgJHNjb3BlLnN0YXRlID0gJ3dhaXRpbmdGb3JCb3gnO1xuICAgICAgICAgICAgICAgIHJldHVybiAkdGltZW91dChpbml0aWFsaXplLCAzMDAwKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZG9tYWluIGlzIGN1cnJlbnRseSBsaWtlIGEgbG9jayBmbGFnXG4gICAgICAgICAgICBpZiAoc3RhdHVzLmFkbWluRnFkbikgcmV0dXJuIHdhaXRGb3JEbnNTZXR1cCgpO1xuXG4gICAgICAgICAgICBpZiAoc3RhdHVzLnByb3ZpZGVyID09PSAnZGlnaXRhbG9jZWFuJyB8fCBzdGF0dXMucHJvdmlkZXIgPT09ICdkaWdpdGFsb2NlYW4tbXAnKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyID0gJ2RpZ2l0YWxvY2Vhbic7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cy5wcm92aWRlciA9PT0gJ2xpbm9kZScgfHwgc3RhdHVzLnByb3ZpZGVyID09PSAnbGlub2RlLW9uZWNsaWNrJyB8fCBzdGF0dXMucHJvdmlkZXIgPT09ICdsaW5vZGUtc3RhY2tzY3JpcHQnKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyID0gJ2xpbm9kZSc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cy5wcm92aWRlciA9PT0gJ3Z1bHRyJyB8fCBzdGF0dXMucHJvdmlkZXIgPT09ICd2dWx0ci1tcCcpIHtcbiAgICAgICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMucHJvdmlkZXIgPSAndnVsdHInO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMucHJvdmlkZXIgPT09ICdnY2UnKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyID0gJ2djZG5zJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzLnByb3ZpZGVyID09PSAnYW1pJykge1xuICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlciA9ICdyb3V0ZTUzJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgJHNjb3BlLmluc3RhbmNlSWQgPSBzZWFyY2guaW5zdGFuY2VJZDtcbiAgICAgICAgICAgICRzY29wZS5zZXR1cFRva2VuID0gc2VhcmNoLnNldHVwVG9rZW47XG4gICAgICAgICAgICAkc2NvcGUucHJvdmlkZXIgPSBzdGF0dXMucHJvdmlkZXI7XG4gICAgICAgICAgICAkc2NvcGUud2ViU2VydmVyT3JpZ2luID0gc3RhdHVzLndlYlNlcnZlck9yaWdpbjtcbiAgICAgICAgICAgICRzY29wZS5zdGF0ZSA9ICdpbml0aWFsaXplZCc7XG5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkgeyAkKFwiW2F1dG9mb2N1c106Zmlyc3RcIikuZm9jdXMoKTsgfSwgMTAwKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIGNsaXBib2FyZCA9IG5ldyBDbGlwYm9hcmQoJy5jbGlwYm9hcmQnKTtcbiAgICBjbGlwYm9hcmQub24oJ3N1Y2Nlc3MnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICRzY29wZS4kYXBwbHkoZnVuY3Rpb24gKCkgeyAkc2NvcGUuY2xpcGJvYXJkRG9uZSA9IHRydWU7IH0pO1xuICAgICAgICAkdGltZW91dChmdW5jdGlvbiAoKSB7ICRzY29wZS5jbGlwYm9hcmREb25lID0gZmFsc2U7IH0sIDUwMDApO1xuICAgIH0pO1xuXG4gICAgaW5pdGlhbGl6ZSgpO1xufV0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKiBnbG9iYWwgJCAqL1xuLyogZ2xvYmFsIGFuZ3VsYXIgKi9cbi8qIGdsb2JhbCBFdmVudFNvdXJjZSAqL1xuLyogZ2xvYmFsIGFzeW5jICovXG5cbi8vIGtlZXAgaW4gc3luYyB3aXRoIGJveC9zcmMvYXBwcy5qc1xudmFyIElTVEFURVMgPSB7XG4gICAgUEVORElOR19JTlNUQUxMOiAncGVuZGluZ19pbnN0YWxsJyxcbiAgICBQRU5ESU5HX0NMT05FOiAncGVuZGluZ19jbG9uZScsXG4gICAgUEVORElOR19DT05GSUdVUkU6ICdwZW5kaW5nX2NvbmZpZ3VyZScsXG4gICAgUEVORElOR19VTklOU1RBTEw6ICdwZW5kaW5nX3VuaW5zdGFsbCcsXG4gICAgUEVORElOR19SRVNUT1JFOiAncGVuZGluZ19yZXN0b3JlJyxcbiAgICBQRU5ESU5HX0lNUE9SVDogJ3BlbmRpbmdfaW1wb3J0JyxcbiAgICBQRU5ESU5HX1VQREFURTogJ3BlbmRpbmdfdXBkYXRlJyxcbiAgICBQRU5ESU5HX0JBQ0tVUDogJ3BlbmRpbmdfYmFja3VwJyxcbiAgICBQRU5ESU5HX1JFQ1JFQVRFX0NPTlRBSU5FUjogJ3BlbmRpbmdfcmVjcmVhdGVfY29udGFpbmVyJywgLy8gZW52IGNoYW5nZSBvciBhZGRvbiBjaGFuZ2VcbiAgICBQRU5ESU5HX0xPQ0FUSU9OX0NIQU5HRTogJ3BlbmRpbmdfbG9jYXRpb25fY2hhbmdlJyxcbiAgICBQRU5ESU5HX0RBVEFfRElSX01JR1JBVElPTjogJ3BlbmRpbmdfZGF0YV9kaXJfbWlncmF0aW9uJyxcbiAgICBQRU5ESU5HX1JFU0laRTogJ3BlbmRpbmdfcmVzaXplJyxcbiAgICBQRU5ESU5HX0RFQlVHOiAncGVuZGluZ19kZWJ1ZycsXG4gICAgUEVORElOR19TVEFSVDogJ3BlbmRpbmdfc3RhcnQnLFxuICAgIFBFTkRJTkdfU1RPUDogJ3BlbmRpbmdfc3RvcCcsXG4gICAgUEVORElOR19SRVNUQVJUOiAncGVuZGluZ19yZXN0YXJ0JyxcbiAgICBFUlJPUjogJ2Vycm9yJyxcbiAgICBJTlNUQUxMRUQ6ICdpbnN0YWxsZWQnXG59O1xuXG52YXIgSFNUQVRFUyA9IHtcbiAgICBIRUFMVEhZOiAnaGVhbHRoeScsXG4gICAgVU5IRUFMVEhZOiAndW5oZWFsdGh5JyxcbiAgICBFUlJPUjogJ2Vycm9yJyxcbiAgICBERUFEOiAnZGVhZCdcbn07XG5cbnZhciBSU1RBVEVTID17XG4gICAgUlVOTklORzogJ3J1bm5pbmcnLFxuICAgIFNUT1BQRUQ6ICdzdG9wcGVkJ1xufTtcblxudmFyIEVSUk9SID0ge1xuICAgIEFDQ0VTU19ERU5JRUQ6ICdBY2Nlc3MgRGVuaWVkJyxcbiAgICBBTFJFQURZX0VYSVNUUzogJ0FscmVhZHkgRXhpc3RzJyxcbiAgICBCQURfRklFTEQ6ICdCYWQgRmllbGQnLFxuICAgIENPTExFQ1REX0VSUk9SOiAnQ29sbGVjdGQgRXJyb3InLFxuICAgIENPTkZMSUNUOiAnQ29uZmxpY3QnLFxuICAgIERBVEFCQVNFX0VSUk9SOiAnRGF0YWJhc2UgRXJyb3InLFxuICAgIEROU19FUlJPUjogJ0ROUyBFcnJvcicsXG4gICAgRE9DS0VSX0VSUk9SOiAnRG9ja2VyIEVycm9yJyxcbiAgICBFWFRFUk5BTF9FUlJPUjogJ0V4dGVybmFsIEVycm9yJyxcbiAgICBGU19FUlJPUjogJ0ZpbGVTeXN0ZW0gRXJyb3InLFxuICAgIElOVEVSTkFMX0VSUk9SOiAnSW50ZXJuYWwgRXJyb3InLFxuICAgIExPR1JPVEFURV9FUlJPUjogJ0xvZ3JvdGF0ZSBFcnJvcicsXG4gICAgTkVUV09SS19FUlJPUjogJ05ldHdvcmsgRXJyb3InLFxuICAgIE5PVF9GT1VORDogJ05vdCBmb3VuZCcsXG4gICAgUkVWRVJTRVBST1hZX0VSUk9SOiAnUmV2ZXJzZVByb3h5IEVycm9yJyxcbiAgICBUQVNLX0VSUk9SOiAnVGFzayBFcnJvcicsXG4gICAgVU5LTk9XTl9FUlJPUjogJ1Vua25vd24gRXJyb3InIC8vIG9ubHkgdXNlZCBmb3IgcG9ydGluLFxufTtcblxudmFyIFJPTEVTID0ge1xuICAgIE9XTkVSOiAnb3duZXInLFxuICAgIEFETUlOOiAnYWRtaW4nLFxuICAgIFVTRVJfTUFOQUdFUjogJ3VzZXJtYW5hZ2VyJyxcbiAgICBVU0VSOiAndXNlcidcbn07XG5cbi8vIHN5bmMgdXAgd2l0aCB0YXNrcy5qc1xudmFyIFRBU0tfVFlQRVMgPSB7XG4gICAgVEFTS19BUFA6ICdhcHAnLFxuICAgIFRBU0tfQkFDS1VQOiAnYmFja3VwJyxcbiAgICBUQVNLX1VQREFURTogJ3VwZGF0ZScsXG4gICAgVEFTS19SRU5FV19DRVJUUzogJ3JlbmV3Y2VydHMnLFxuICAgIFRBU0tfU0VUVVBfRE5TX0FORF9DRVJUOiAnc2V0dXBEbnNBbmRDZXJ0JyxcbiAgICBUQVNLX0NMRUFOX0JBQ0tVUFM6ICdjbGVhbkJhY2t1cHMnLFxuICAgIFRBU0tfU1lOQ19FWFRFUk5BTF9MREFQOiAnc3luY0V4dGVybmFsTGRhcCcsXG4gICAgVEFTS19DSEFOR0VfTUFJTF9MT0NBVElPTjogJ2NoYW5nZU1haWxMb2NhdGlvbicsXG4gICAgVEFTS19TWU5DX0ROU19SRUNPUkRTOiAnc3luY0Ruc1JlY29yZHMnLFxufTtcblxudmFyIFNFQ1JFVF9QTEFDRUhPTERFUiA9IFN0cmluZy5mcm9tQ2hhckNvZGUoMHgyNUNGKS5yZXBlYXQoOCk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlbHBlciB0byBlbnN1cmUgbG9hZGluZyBhIGZhbGxiYWNrIGFwcCBpY29uIG9uIGZpcnN0IGxvYWQgZmFpbHVyZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZnVuY3Rpb24gaW1hZ2VFcnJvckhhbmRsZXIoZWxlbSkge1xuICAgIGVsZW0uc3JjID0gZWxlbS5nZXRBdHRyaWJ1dGUoJ2ZhbGxiYWNrLWljb24nKTtcbiAgICBlbGVtLm9uZXJyb3IgPSBudWxsOyAgICAvLyBhdm9pZCByZXRyeSBhZnRlciBkZWZhdWx0IGljb24gY2Fubm90IGJlIGxvYWRlZFxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTaGFyZWQgQW5ndWxhciBGaWx0ZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIGJpbmFyeSB1bml0cyAobm9uIFNJKSAxMDI0IGJhc2VkXG5mdW5jdGlvbiBwcmV0dHlCeXRlU2l6ZShzaXplLCBmYWxsYmFjaykge1xuICAgIGlmICghc2l6ZSkgcmV0dXJuIGZhbGxiYWNrIHx8IDA7XG5cbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoTWF0aC5sb2coc2l6ZSkgLyBNYXRoLmxvZygxMDI0KSk7XG4gICAgcmV0dXJuIChzaXplIC8gTWF0aC5wb3coMTAyNCwgaSkpLnRvRml4ZWQoMikgKiAxICsgJyAnICsgWydCJywgJ2tCJywgJ01CJywgJ0dCJywgJ1RCJ11baV07XG59XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigncHJldHR5Qnl0ZVNpemUnLCBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChzaXplLCBmYWxsYmFjaykgeyByZXR1cm4gcHJldHR5Qnl0ZVNpemUoc2l6ZSwgZmFsbGJhY2spIHx8ICcwIGtiJzsgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eURpc2tTaXplJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoc2l6ZSwgZmFsbGJhY2spIHsgcmV0dXJuIHByZXR0eUJ5dGVTaXplKHNpemUsIGZhbGxiYWNrKSB8fCAnTm90IGF2YWlsYWJsZSB5ZXQnOyB9O1xufSk7XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigndHJLZXlGcm9tUGVyaW9kJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAocGVyaW9kKSB7XG4gICAgICAgIGlmIChwZXJpb2QgPT09IDYpIHJldHVybiAnYXBwLmdyYXBocy5wZXJpb2QuNmgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAxMikgcmV0dXJuICdhcHAuZ3JhcGhzLnBlcmlvZC4xMmgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAyNCkgcmV0dXJuICdhcHAuZ3JhcGhzLnBlcmlvZC4yNGgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAyNCo3KSByZXR1cm4gJ2FwcC5ncmFwaHMucGVyaW9kLjdkJztcbiAgICAgICAgaWYgKHBlcmlvZCA9PT0gMjQqMzApIHJldHVybiAnYXBwLmdyYXBocy5wZXJpb2QuMzBkJztcblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eURhdGUnLCBmdW5jdGlvbiAoJHRyYW5zbGF0ZSkge1xuICAgIC8vIGh0dHA6Ly9lam9obi5vcmcvZmlsZXMvcHJldHR5LmpzXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHByZXR0eURhdGUodXRjKSB7XG4gICAgICAgIHZhciBkYXRlID0gbmV3IERhdGUodXRjKSwgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgICAgICAgICBkaWZmID0gKCgobmV3IERhdGUoKSkuZ2V0VGltZSgpIC0gZGF0ZS5nZXRUaW1lKCkpIC8gMTAwMCkgKyAzMCwgLy8gYWRkIDMwc2Vjb25kcyBmb3IgY2xvY2sgc2tld1xuICAgICAgICAgICAgZGF5X2RpZmYgPSBNYXRoLmZsb29yKGRpZmYgLyA4NjQwMCk7XG5cbiAgICAgICAgaWYgKGlzTmFOKGRheV9kaWZmKSB8fCBkYXlfZGlmZiA8IDApIHJldHVybiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5qdXN0Tm93Jywge30pO1xuXG4gICAgICAgIHJldHVybiBkYXlfZGlmZiA9PT0gMCAmJiAoXG4gICAgICAgICAgICAgICAgZGlmZiA8IDYwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmp1c3ROb3cnLCB7fSkgfHxcbiAgICAgICAgICAgICAgICBkaWZmIDwgMTIwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLm1pbnV0ZXNBZ28nLCB7IG06IDEgfSkgfHxcbiAgICAgICAgICAgICAgICBkaWZmIDwgMzYwMCAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5taW51dGVzQWdvJywgeyBtOiBNYXRoLmZsb29yKCBkaWZmIC8gNjAgKSB9KSB8fFxuICAgICAgICAgICAgICAgIGRpZmYgPCA3MjAwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmhvdXJzQWdvJywgeyBoOiAxIH0pIHx8XG4gICAgICAgICAgICAgICAgZGlmZiA8IDg2NDAwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmhvdXJzQWdvJywgeyBoOiBNYXRoLmZsb29yKCBkaWZmIC8gMzYwMCApIH0pXG4gICAgICAgICAgICApIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA9PT0gMSAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS55ZXNlcmRheScsIHt9KSB8fFxuICAgICAgICAgICAgZGF5X2RpZmYgPCA3ICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmRheXNBZ28nLCB7IGQ6IGRheV9kaWZmIH0pIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA8IDMxICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLndlZWtzQWdvJywgeyB3OiBNYXRoLmNlaWwoIGRheV9kaWZmIC8gNyApIH0pIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA8IDM2NSAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5tb250aHNBZ28nLCB7IG06IE1hdGgucm91bmQoIGRheV9kaWZmIC8gMzAgKSB9KSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJHRyYW5zbGF0ZS5pbnN0YW50KCdtYWluLnByZXR0eURhdGUueWVhcnNBZ28nLCB7IG06IE1hdGgucm91bmQoIGRheV9kaWZmIC8gMzY1ICkgfSk7XG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eUxvbmdEYXRlJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiBwcmV0dHlMb25nRGF0ZSh1dGMpIHtcbiAgICAgICAgcmV0dXJuIG1vbWVudCh1dGMpLmZvcm1hdCgnTU1NTSBEbyBZWVlZLCBoOm1tOnNzIGEnKTsgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eVNob3J0RGF0ZScsIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gcHJldHR5U2hvcnREYXRlKHV0Yykge1xuICAgICAgICByZXR1cm4gbW9tZW50KHV0YykuZm9ybWF0KCdNTU1NIERvIFlZWVknKTsgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ21hcmtkb3duMmh0bWwnLCBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNvbnZlcnRlciA9IG5ldyBzaG93ZG93bi5Db252ZXJ0ZXIoe1xuICAgICAgICBzaW1wbGlmaWVkQXV0b0xpbms6IHRydWUsXG4gICAgICAgIHN0cmlrZXRocm91Z2g6IHRydWUsXG4gICAgICAgIHRhYmxlczogdHJ1ZSxcbiAgICAgICAgb3BlbkxpbmtzSW5OZXdXaW5kb3c6IHRydWVcbiAgICB9KTtcblxuICAgIC8vIHdpdGhvdXQgdGhpcyBjYWNoZSwgdGhlIGNvZGUgcnVucyBpbnRvIHNvbWUgaW5maW5pdGUgbG9vcCAoaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci5qcy9pc3N1ZXMvMzk4MClcbiAgICB2YXIgY2FjaGUgPSB7fTtcblxuICAgIHJldHVybiBmdW5jdGlvbiAodGV4dCkge1xuICAgICAgICBpZiAoY2FjaGVbdGV4dF0pIHJldHVybiBjYWNoZVt0ZXh0XTtcbiAgICAgICAgY2FjaGVbdGV4dF0gPSBjb252ZXJ0ZXIubWFrZUh0bWwodGV4dCk7XG4gICAgICAgIHJldHVybiBjYWNoZVt0ZXh0XTtcbiAgICB9O1xufSk7XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmNvbmZpZyhbJyR0cmFuc2xhdGVQcm92aWRlcicsIGZ1bmN0aW9uICgkdHJhbnNsYXRlUHJvdmlkZXIpIHtcbiAgICAkdHJhbnNsYXRlUHJvdmlkZXIudXNlU3RhdGljRmlsZXNMb2FkZXIoe1xuICAgICAgICBwcmVmaXg6ICd0cmFuc2xhdGlvbi8nLFxuICAgICAgICBzdWZmaXg6ICcuanNvbj8nICsgJzM2Njk0OTc1MzE5NGNjYjk0MWQyY2QwNzEzMGQ1ZDI0YzE3YWMzNjUnXG4gICAgfSk7XG4gICAgJHRyYW5zbGF0ZVByb3ZpZGVyLnVzZUxvY2FsU3RvcmFnZSgpO1xuICAgICR0cmFuc2xhdGVQcm92aWRlci5wcmVmZXJyZWRMYW5ndWFnZSgnZW4nKTtcbiAgICAkdHJhbnNsYXRlUHJvdmlkZXIuZmFsbGJhY2tMYW5ndWFnZSgnZW4nKTtcbn1dKTtcblxuLy8gQWRkIHNob3J0aGFuZCBcInRyXCIgZmlsdGVyIHRvIGF2b2lkIGhhdmluZyBvdCB1c2UgXCJ0cmFuc2xhdGVcIlxuLy8gVGhpcyBpcyBhIGNvcHkgb2YgdGhlIGNvZGUgYXQgaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXItdHJhbnNsYXRlL2FuZ3VsYXItdHJhbnNsYXRlL2Jsb2IvbWFzdGVyL3NyYy9maWx0ZXIvdHJhbnNsYXRlLmpzXG4vLyBJZiB3ZSBmaW5kIG91dCBob3cgdG8gZ2V0IHRoYXQgZnVuY3Rpb24gaGFuZGxlIHNvbWVob3cgZHluYW1pY2FsbHkgd2UgY2FuIHVzZSB0aGF0LCBvdGhlcndpc2UgdGhlIGNvcHkgaXMgcmVxdWlyZWRcbmZ1bmN0aW9uIHRyYW5zbGF0ZUZpbHRlckZhY3RvcnkoJHBhcnNlLCAkdHJhbnNsYXRlKSB7XG4gIHZhciB0cmFuc2xhdGVGaWx0ZXIgPSBmdW5jdGlvbiAodHJhbnNsYXRpb25JZCwgaW50ZXJwb2xhdGVQYXJhbXMsIGludGVycG9sYXRpb24sIGZvcmNlTGFuZ3VhZ2UpIHtcbiAgICBpZiAoIWFuZ3VsYXIuaXNPYmplY3QoaW50ZXJwb2xhdGVQYXJhbXMpKSB7XG4gICAgICB2YXIgY3R4ID0gdGhpcyB8fCB7XG4gICAgICAgICdfX1NDT1BFX0lTX05PVF9BVkFJTEFCTEUnOiAnTW9yZSBpbmZvIGF0IGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXIuanMvY29tbWl0Lzg4NjNiOWQwNGM3MjJiMjc4ZmE5M2M1ZDY2YWQxZTU3OGFkNmViMWYnXG4gICAgICAgIH07XG4gICAgICBpbnRlcnBvbGF0ZVBhcmFtcyA9ICRwYXJzZShpbnRlcnBvbGF0ZVBhcmFtcykoY3R4KTtcbiAgICB9XG5cbiAgICByZXR1cm4gJHRyYW5zbGF0ZS5pbnN0YW50KHRyYW5zbGF0aW9uSWQsIGludGVycG9sYXRlUGFyYW1zLCBpbnRlcnBvbGF0aW9uLCBmb3JjZUxhbmd1YWdlKTtcbiAgfTtcblxuICBpZiAoJHRyYW5zbGF0ZS5zdGF0ZWZ1bEZpbHRlcigpKSB7XG4gICAgdHJhbnNsYXRlRmlsdGVyLiRzdGF0ZWZ1bCA9IHRydWU7XG4gIH1cblxuICByZXR1cm4gdHJhbnNsYXRlRmlsdGVyO1xufVxudHJhbnNsYXRlRmlsdGVyRmFjdG9yeS5kaXNwbGF5TmFtZSA9ICd0cmFuc2xhdGVGaWx0ZXJGYWN0b3J5JztcbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigndHInLCB0cmFuc2xhdGVGaWx0ZXJGYWN0b3J5KTtcblxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDbG91ZHJvbiBSRVNUIEFQSSB3cmFwcGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLnNlcnZpY2UoJ0NsaWVudCcsIFsnJGh0dHAnLCAnJGludGVydmFsJywgJyR0aW1lb3V0JywgJ21kNScsICdOb3RpZmljYXRpb24nLCBmdW5jdGlvbiAoJGh0dHAsICRpbnRlcnZhbCwgJHRpbWVvdXQsIG1kNSwgTm90aWZpY2F0aW9uKSB7XG4gICAgdmFyIGNsaWVudCA9IG51bGw7XG5cbiAgICAvLyB2YXJpYWJsZSBhdmFpbGFibGUgb25seSBoZXJlIHRvIGF2b2lkIHRoaXMuX3Byb3BlcnR5IHBhdHRlcm5cbiAgICB2YXIgdG9rZW4gPSBudWxsO1xuXG4gICAgZnVuY3Rpb24gQ2xpZW50RXJyb3Ioc3RhdHVzQ29kZSwgbWVzc2FnZU9yT2JqZWN0KSB7XG4gICAgICAgIEVycm9yLmNhbGwodGhpcyk7XG4gICAgICAgIHRoaXMubmFtZSA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICAgICAgdGhpcy5zdGF0dXNDb2RlID0gc3RhdHVzQ29kZTtcbiAgICAgICAgaWYgKG1lc3NhZ2VPck9iamVjdCA9PT0gbnVsbCB8fCB0eXBlb2YgbWVzc2FnZU9yT2JqZWN0ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgdGhpcy5tZXNzYWdlID0gJ0VtcHR5IG1lc3NhZ2Ugb3Igb2JqZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgbWVzc2FnZU9yT2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZU9yT2JqZWN0O1xuICAgICAgICB9IGVsc2UgaWYgKG1lc3NhZ2VPck9iamVjdCkge1xuICAgICAgICAgICAgYW5ndWxhci5leHRlbmQodGhpcywgbWVzc2FnZU9yT2JqZWN0KTsgLy8gc3RhdHVzLCBtZXNzYWdlLCByZWFzb24gYW5kIG90aGVyIHByb3BlcnRpZXNcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spIHtcbiAgICAgICAgZnVuY3Rpb24gaGFuZGxlU2VydmVyT2ZmbGluZSgpIHtcbiAgICAgICAgICAgIGlmIChjbGllbnQub2ZmbGluZSkgcmV0dXJuO1xuICAgICAgICAgICAgY2xpZW50Lm9mZmxpbmUgPSB0cnVlO1xuXG4gICAgICAgICAgICAoZnVuY3Rpb24gb25saW5lQ2hlY2soKSB7XG4gICAgICAgICAgICAgICAgJGh0dHAuZ2V0KGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9jbG91ZHJvbi9zdGF0dXMnLCB7fSkuc3VjY2VzcyhmdW5jdGlvbiAoZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNsaWVudC5vZmZsaW5lID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGNsaWVudC5fcmVjb25uZWN0TGlzdGVuZXIuZm9yRWFjaChmdW5jdGlvbiAoaGFuZGxlcikgeyBoYW5kbGVyKCk7IH0pO1xuICAgICAgICAgICAgICAgIH0pLmVycm9yKGZ1bmN0aW9uIChkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgJHRpbWVvdXQob25saW5lQ2hlY2ssIDUwMDApO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgcmVxdWVzdCBraWxsZWQgYnkgYnJvd3NlciAoZWcuIGNvcnMgaXNzdWUpXG4gICAgICAgICAgICBpZiAoZGF0YSA9PT0gbnVsbCAmJiBzdGF0dXMgPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgaGFuZGxlU2VydmVyT2ZmbGluZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3IoJ1JlcXVlc3QgY2FuY2VsbGVkIGJ5IGJyb3dzZXInKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHJlLWxvZ2luIHdpbGwgbWFrZSB0aGUgY29kZSBnZXQgYSBuZXcgdG9rZW5cbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09IDQwMSkgcmV0dXJuIGNsaWVudC5sb2dpbigpO1xuXG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSA1MDAgfHwgc3RhdHVzID09PSA1MDEpIHtcbiAgICAgICAgICAgICAgICAvLyBhY3R1YWwgaW50ZXJuYWwgc2VydmVyIGVycm9yLCBtb3N0IGxpa2VseSBhIGJ1ZyBvciB0aW1lb3V0IGxvZyB0byBjb25zb2xlIG9ubHkgdG8gbm90IGFsZXJ0IHRoZSB1c2VyXG4gICAgICAgICAgICAgICAgaWYgKCFjbGllbnQub2ZmbGluZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKHN0YXR1cywgZGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCctLS0tLS1cXG5DbG91ZHJvbiBJbnRlcm5hbCBFcnJvclxcblxcbklmIHlvdSBzZWUgdGhpcywgcGxlYXNlIHNlbmQgYSBtYWlsIHdpdGggYWJvdmUgbG9nIHRvIHN1cHBvcnRAY2xvdWRyb24uaW9cXG4tLS0tLS1cXG4nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gNTAyIHx8IHN0YXR1cyA9PT0gNTAzIHx8IHN0YXR1cyA9PT0gNTA0KSB7XG4gICAgICAgICAgICAgICAgLy8gVGhpcyBtZWFucyB0aGUgYm94IHNlcnZpY2UgaXMgbm90IHJlYWNoYWJsZS4gV2UganVzdCBzaG93IG9mZmxpbmUgYmFubmVyIGZvciBub3dcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHN0YXR1cyA+PSA1MDIpIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVTZXJ2ZXJPZmZsaW5lKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIG9iaiA9IGRhdGE7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG9iaiA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7fVxuXG4gICAgICAgICAgICBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBvYmopKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoY2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBkYXRhLCBzdGF0dXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFhIUiB3cmFwcGVyIHRvIHNldCB0aGUgYXV0aCBoZWFkZXJcbiAgICBmdW5jdGlvbiBnZXQodXJsLCBjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSAzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdHRVQnLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhyb3coJ1dyb25nIG51bWJlciBvZiBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbmZpZyA9IGNvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMgPSBjb25maWcuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXG4gICAgICAgIHJldHVybiAkaHR0cC5nZXQoY2xpZW50LmFwaU9yaWdpbiArIHVybCwgY29uZmlnKVxuICAgICAgICAgICAgLnN1Y2Nlc3MoZGVmYXVsdFN1Y2Nlc3NIYW5kbGVyKGNhbGxiYWNrKSlcbiAgICAgICAgICAgIC5lcnJvcihkZWZhdWx0RXJyb3JIYW5kbGVyKGNhbGxiYWNrKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGVhZCh1cmwsIGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggIT09IDMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0hFQUQnLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhyb3coJ1dyb25nIG51bWJlciBvZiBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbmZpZyA9IGNvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMgPSBjb25maWcuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXG4gICAgICAgIHJldHVybiAkaHR0cC5oZWFkKGNsaWVudC5hcGlPcmlnaW4gKyB1cmwsIGNvbmZpZylcbiAgICAgICAgICAgIC5zdWNjZXNzKGRlZmF1bHRTdWNjZXNzSGFuZGxlcihjYWxsYmFjaykpXG4gICAgICAgICAgICAuZXJyb3IoZGVmYXVsdEVycm9ySGFuZGxlcihjYWxsYmFjaykpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBvc3QodXJsLCBkYXRhLCBjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSA0KSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdQT1NUJywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIHRocm93KCdXcm9uZyBudW1iZXIgb2YgYXJndW1lbnRzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhID0gZGF0YSB8fCB7fTtcbiAgICAgICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycyA9IGNvbmZpZy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cbiAgICAgICAgcmV0dXJuICRodHRwLnBvc3QoY2xpZW50LmFwaU9yaWdpbiArIHVybCwgZGF0YSwgY29uZmlnKVxuICAgICAgICAgICAgLnN1Y2Nlc3MoZGVmYXVsdFN1Y2Nlc3NIYW5kbGVyKGNhbGxiYWNrKSlcbiAgICAgICAgICAgIC5lcnJvcihkZWZhdWx0RXJyb3JIYW5kbGVyKGNhbGxiYWNrKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcHV0KHVybCwgZGF0YSwgY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCAhPT0gNCkge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignUFVUJywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIHRocm93KCdXcm9uZyBudW1iZXIgb2YgYXJndW1lbnRzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBkYXRhID0gZGF0YSB8fCB7fTtcbiAgICAgICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycyA9IGNvbmZpZy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cbiAgICAgICAgcmV0dXJuICRodHRwLnB1dChjbGllbnQuYXBpT3JpZ2luICsgdXJsLCBkYXRhLCBjb25maWcpXG4gICAgICAgICAgICAuc3VjY2VzcyhkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoY2FsbGJhY2spKVxuICAgICAgICAgICAgLmVycm9yKGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWwodXJsLCBjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSAzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdERUwnLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhyb3coJ1dyb25nIG51bWJlciBvZiBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbmZpZyA9IGNvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMgPSBjb25maWcuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgY29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXG4gICAgICAgIHJldHVybiAkaHR0cC5kZWxldGUoY2xpZW50LmFwaU9yaWdpbiArIHVybCwgY29uZmlnKVxuICAgICAgICAgICAgLnN1Y2Nlc3MoZGVmYXVsdFN1Y2Nlc3NIYW5kbGVyKGNhbGxiYWNrKSlcbiAgICAgICAgICAgIC5lcnJvcihkZWZhdWx0RXJyb3JIYW5kbGVyKGNhbGxiYWNrKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gQ2xpZW50KCkge1xuICAgICAgICB0aGlzLm9mZmxpbmUgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29uZmlnTGlzdGVuZXIgPSBbXTtcbiAgICAgICAgdGhpcy5fcmVhZHlMaXN0ZW5lciA9IFtdO1xuICAgICAgICB0aGlzLl9yZWNvbm5lY3RMaXN0ZW5lciA9IFtdO1xuICAgICAgICB0aGlzLl91c2VySW5mbyA9IHtcbiAgICAgICAgICAgIGlkOiBudWxsLFxuICAgICAgICAgICAgdXNlcm5hbWU6IG51bGwsXG4gICAgICAgICAgICBlbWFpbDogbnVsbCxcbiAgICAgICAgICAgIHR3b0ZhY3RvckF1dGhlbnRpY2F0aW9uRW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgICBzb3VyY2U6IG51bGwsXG4gICAgICAgICAgICBhdmF0YXJVcmw6IG51bGxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fY29uZmlnID0ge1xuICAgICAgICAgICAgYXBpU2VydmVyT3JpZ2luOiBudWxsLFxuICAgICAgICAgICAgd2ViU2VydmVyT3JpZ2luOiBudWxsLFxuICAgICAgICAgICAgZnFkbjogbnVsbCxcbiAgICAgICAgICAgIGlwOiBudWxsLFxuICAgICAgICAgICAgcmV2aXNpb246IG51bGwsXG4gICAgICAgICAgICB1cGRhdGU6IHsgYm94OiBudWxsLCBhcHBzOiBudWxsIH0sXG4gICAgICAgICAgICBwcm9ncmVzczoge30sXG4gICAgICAgICAgICByZWdpb246IG51bGwsXG4gICAgICAgICAgICBzaXplOiBudWxsXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuX2luc3RhbGxlZEFwcHMgPSBbXTtcbiAgICAgICAgdGhpcy5faW5zdGFsbGVkQXBwc0J5SWQgPSB7fTtcbiAgICAgICAgdGhpcy5fYXBwVGFncyA9IFtdO1xuICAgICAgICAvLyB3aW5kb3cubG9jYXRpb24gZmFsbGJhY2sgZm9yIHdlYnNvY2tldCBjb25uZWN0aW9ucyB3aGljaCBkbyBub3QgaGF2ZSByZWxhdGl2ZSB1cmlzXG4gICAgICAgIHRoaXMuYXBpT3JpZ2luID0gJycgfHwgd2luZG93LmxvY2F0aW9uLm9yaWdpbjtcbiAgICAgICAgdGhpcy5hdmF0YXIgPSAnJztcbiAgICAgICAgdGhpcy5fYXZhaWxhYmxlTGFuZ3VhZ2VzID0gWydlbiddO1xuICAgICAgICB0aGlzLl9hcHBzdG9yZUFwcENhY2hlID0gW107XG5cbiAgICAgICAgdGhpcy5yZXNldEF2YXRhcigpO1xuXG4gICAgICAgIHRoaXMuc2V0VG9rZW4obG9jYWxTdG9yYWdlLnRva2VuKTtcbiAgICB9XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmVycm9yID0gZnVuY3Rpb24gKGVycm9yLCBhY3Rpb24pIHtcbiAgICAgICAgdmFyIG1lc3NhZ2UgPSAnJztcblxuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcblxuICAgICAgICBpZiAodHlwZW9mIGVycm9yID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgbWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgZXJyb3I7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBtZXNzYWdlID0gZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBnaXZlIG1vcmUgaW5mbyBpbiBjYXNlIHRoZSBlcnJvciB3YXMgYSByZXF1ZXN0IHdoaWNoIGZhaWxlZCB3aXRoIGVtcHR5IHJlc3BvbnNlIGJvZHksXG4gICAgICAgIC8vIHRoaXMgaGFwcGVucyBtb3N0bHkgaWYgdGhlIGJveCBjcmFzaGVzXG4gICAgICAgIGlmIChtZXNzYWdlID09PSAnRW1wdHkgbWVzc2FnZSBvciBvYmplY3QnKSB7XG4gICAgICAgICAgICBtZXNzYWdlID0gJ0dvdCBlbXB0eSByZXNwb25zZS4gQ2xpY2sgdG8gY2hlY2sgdGhlIHNlcnZlciBsb2dzLic7XG4gICAgICAgICAgICBhY3Rpb24gPSBhY3Rpb24gfHwgJy9sb2dzLmh0bWw/aWQ9Ym94JztcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubm90aWZ5KCdDbG91ZHJvbiBFcnJvcicsIG1lc3NhZ2UsIHRydWUsICdlcnJvcicsIGFjdGlvbik7XG4gICAgfTtcblxuICAgIC8vIGhhbmRsZXMgYXBwbGljYXRpb24gc3RhcnR1cCBlcnJvcnMsIG1vc3RseSBvbmx5IHdoZW4gZGFzaGJvYXJkIGlzIGxvYWRlZCBhbmQgYXBpIGVuZHBvaW50IGlzIGRvd25cbiAgICBDbGllbnQucHJvdG90eXBlLmluaXRFcnJvciA9IGZ1bmN0aW9uIChlcnJvciwgaW5pdEZ1bmN0aW9uKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0FwcGxpY2F0aW9uIHN0YXJ0dXAgZXJyb3InLCBlcnJvcik7XG5cbiAgICAgICAgJHRpbWVvdXQoaW5pdEZ1bmN0aW9uLCA1MDAwKTsgLy8gd2Ugd2lsbCB0cnkgdG8gcmUtaW5pdCB0aGUgYXBwXG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY2xlYXJOb3RpZmljYXRpb25zID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBOb3RpZmljYXRpb24uY2xlYXJBbGwoKTtcbiAgICB9O1xuXG4gICAgLypcblxuICAgIElmIGBhY3Rpb25gIGlzIGEgbm9uLWVtcHR5IHN0cmluZywgaXQgd2lsbCBiZSB0cmVhdGVkIGFzIGEgdXJsLCBpZiBpdCBpcyBhIGZ1bmN0aW9uLCB0aGF0IGZ1bmN0aW9uIHdpbGwgYmUgZXhlY3R1ZWQgb24gY2xpY2tcblxuICAgICovXG4gICAgQ2xpZW50LnByb3RvdHlwZS5ub3RpZnkgPSBmdW5jdGlvbiAodGl0bGUsIG1lc3NhZ2UsIHBlcnNpc3RlbnQsIHR5cGUsIGFjdGlvbikge1xuICAgICAgICB2YXIgb3B0aW9ucyA9IHsgdGl0bGU6IHRpdGxlLCBtZXNzYWdlOiBtZXNzYWdlfTtcblxuICAgICAgICBpZiAocGVyc2lzdGVudCkgb3B0aW9ucy5kZWxheSA9ICduZXZlcic7IC8vIGFueSBub24gTnVtYmVyIG1lYW5zIG5ldmVyIHRpbWVvdXRcblxuICAgICAgICBpZiAoYWN0aW9uKSB7XG4gICAgICAgICAgICBvcHRpb25zLm9uQ2xpY2sgPSBmdW5jdGlvbiAoLyogcGFyYW1zICovKSB7XG4gICAgICAgICAgICAgICAgLy8gaWYgYWN0aW9uIGlzIGEgc3RyaW5nLCB3ZSBhc3N1bWUgaXQgaXMgYSBsaW5rXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBhY3Rpb24gPT09ICdzdHJpbmcnICYmIGFjdGlvbiAhPT0gJycpIHdpbmRvdy5sb2NhdGlvbiA9IGFjdGlvbjtcbiAgICAgICAgICAgICAgICBlbHNlIGlmICh0eXBlb2YgYWN0aW9uID09PSAnZnVuY3Rpb24nKSBhY3Rpb24oKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbnNvbGUud2FybignTm90aWZpY2F0aW9uIGFjdGlvbiBpcyBub3Qgc3VwcG9ydGVkLicsIGFjdGlvbik7XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGUgPT09ICdlcnJvcicpIE5vdGlmaWNhdGlvbi5lcnJvcihvcHRpb25zKTtcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ3N1Y2Nlc3MnKSBOb3RpZmljYXRpb24uc3VjY2VzcyhvcHRpb25zKTtcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ2luZm8nKSBOb3RpZmljYXRpb24uaW5mbyhvcHRpb25zKTtcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ3dhcm5pbmcnKSBOb3RpZmljYXRpb24ud2FybmluZyhvcHRpb25zKTtcbiAgICAgICAgZWxzZSB0aHJvdygnSW52YWxpZCBub3RpZmljYXRpb24gdHlwZSBcIicgKyB0eXBlICsgJ1wiJyk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0UmVhZHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLl9yZWFkeSkgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fcmVhZHlMaXN0ZW5lci5mb3JFYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gY2xlYXIgdGhlIGxpc3RlbmVycywgd2Ugb25seSBjYWxsYmFjayBvbmNlIVxuICAgICAgICB0aGlzLl9yZWFkeUxpc3RlbmVyID0gW107XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUub25SZWFkeSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBpZiAodGhpcy5fcmVhZHkpIGNhbGxiYWNrKCk7XG4gICAgICAgIGVsc2UgdGhpcy5fcmVhZHlMaXN0ZW5lci5wdXNoKGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5vbkNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB0aGlzLl9jb25maWdMaXN0ZW5lci5wdXNoKGNhbGxiYWNrKTtcbiAgICAgICAgaWYgKHRoaXMuX2NvbmZpZyAmJiB0aGlzLl9jb25maWcuYXBpU2VydmVyT3JpZ2luKSBjYWxsYmFjayh0aGlzLl9jb25maWcpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLm9uUmVjb25uZWN0ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmICh0aGlzLl9yZWFkeSkgY2FsbGJhY2soKTtcbiAgICAgICAgZWxzZSB0aGlzLl9yZWNvbm5lY3RMaXN0ZW5lci5wdXNoKGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXNldEF2YXRhciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5hdmF0YXIgPSB0aGlzLmFwaU9yaWdpbiArICcvYXBpL3YxL2Nsb3Vkcm9uL2F2YXRhcj8nICsgU3RyaW5nKE1hdGgucmFuZG9tKCkpLnNsaWNlKDIpO1xuXG4gICAgICAgIHZhciBmYXZpY29uID0gJCgnI2Zhdmljb24nKTtcbiAgICAgICAgaWYgKGZhdmljb24pIGZhdmljb24uYXR0cignaHJlZicsIHRoaXMuYXZhdGFyKTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRVc2VySW5mbyA9IGZ1bmN0aW9uICh1c2VySW5mbykge1xuICAgICAgICAvLyBJbiBvcmRlciB0byBrZWVwIHRoZSBhbmd1bGFyIGJpbmRpbmdzIGFsaXZlLCBzZXQgZWFjaCBwcm9wZXJ0eSBpbmRpdmlkdWFsbHlcbiAgICAgICAgdGhpcy5fdXNlckluZm8uaWQgPSB1c2VySW5mby5pZDtcbiAgICAgICAgdGhpcy5fdXNlckluZm8udXNlcm5hbWUgPSB1c2VySW5mby51c2VybmFtZTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uZW1haWwgPSB1c2VySW5mby5lbWFpbDtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uZmFsbGJhY2tFbWFpbCA9IHVzZXJJbmZvLmZhbGxiYWNrRW1haWw7XG4gICAgICAgIHRoaXMuX3VzZXJJbmZvLmRpc3BsYXlOYW1lID0gdXNlckluZm8uZGlzcGxheU5hbWU7XG4gICAgICAgIHRoaXMuX3VzZXJJbmZvLnR3b0ZhY3RvckF1dGhlbnRpY2F0aW9uRW5hYmxlZCA9IHVzZXJJbmZvLnR3b0ZhY3RvckF1dGhlbnRpY2F0aW9uRW5hYmxlZDtcbiAgICAgICAgdGhpcy5fdXNlckluZm8ucm9sZSA9IHVzZXJJbmZvLnJvbGU7XG4gICAgICAgIHRoaXMuX3VzZXJJbmZvLnNvdXJjZSA9IHVzZXJJbmZvLnNvdXJjZTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uYXZhdGFyVXJsID0gdXNlckluZm8uYXZhdGFyVXJsICsgJz9zPTEyOCZkZWZhdWx0PW1wJnRzPScgKyBEYXRlLm5vdygpOyAvLyB3ZSBhZGQgdGhlIHRpbWVzdGFtcCB0byBhdm9pZCBjYWNoaW5nXG4gICAgICAgIHRoaXMuX3VzZXJJbmZvLmlzQXRMZWFzdE93bmVyID0gWyBST0xFUy5PV05FUiBdLmluZGV4T2YodXNlckluZm8ucm9sZSkgIT09IC0xO1xuICAgICAgICB0aGlzLl91c2VySW5mby5pc0F0TGVhc3RBZG1pbiA9IFsgUk9MRVMuT1dORVIsIFJPTEVTLkFETUlOIF0uaW5kZXhPZih1c2VySW5mby5yb2xlKSAhPT0gLTE7XG4gICAgICAgIHRoaXMuX3VzZXJJbmZvLmlzQXRMZWFzdFVzZXJNYW5hZ2VyID0gWyBST0xFUy5PV05FUiwgUk9MRVMuQURNSU4sIFJPTEVTLlVTRVJfTUFOQUdFUiBdLmluZGV4T2YodXNlckluZm8ucm9sZSkgIT09IC0xO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldENvbmZpZyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGFuZ3VsYXIuY29weShjb25maWcsIHRoaXMuX2NvbmZpZyk7XG5cblxuXG4gICAgICAgIC8vID0+IFRoaXMgaXMganVzdCBmb3IgZWFzaWVyIHRlc3RpbmdcbiAgICAgICAgLy8gdGhpcy5fY29uZmlnLmZlYXR1cmVzLnVzZXJNYXhDb3VudCA9IDU7XG4gICAgICAgIC8vIHRoaXMuX2NvbmZpZy5mZWF0dXJlcy51c2VyUm9sZXMgPSBmYWxzZTtcbiAgICAgICAgLy8gdGhpcy5fY29uZmlnLmZlYXR1cmVzLnVzZXJHcm91cHMgPSBmYWxzZTtcbiAgICAgICAgLy8gdGhpcy5fY29uZmlnLmZlYXR1cmVzLmRvbWFpbk1heENvdW50ID0gMTtcbiAgICAgICAgLy8gdGhpcy5fY29uZmlnLmZlYXR1cmVzLmV4dGVybmFsTGRhcCA9IGZhbHNlO1xuICAgICAgICAvLyB0aGlzLl9jb25maWcuZmVhdHVyZXMucHJpdmF0ZURvY2tlclJlZ2lzdHJ5ID0gZmFsc2U7XG4gICAgICAgIC8vIHRoaXMuX2NvbmZpZy5mZWF0dXJlcy5icmFuZGluZyA9IHRydWU7XG4gICAgICAgIC8vIHRoaXMuX2NvbmZpZy5mZWF0dXJlcy5zdXBwb3J0ID0gdHJ1ZTtcbiAgICAgICAgLy8gdGhpcy5fY29uZmlnLmZlYXR1cmVzLmRpcmVjdG9yeUNvbmZpZyA9IHRydWU7XG4gICAgICAgIC8vIHRoaXMuX2NvbmZpZy5mZWF0dXJlcy5tYWlsYm94TWF4Q291bnQgPSA1O1xuICAgICAgICAvLyB0aGlzLl9jb25maWcuZmVhdHVyZXMuZW1haWxQcmVtaXVtID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5fY29uZmlnTGlzdGVuZXIuZm9yRWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHRoYXQuX2NvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEluc3RhbGxlZEFwcHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9pbnN0YWxsZWRBcHBzO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcFRhZ3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hcHBUYWdzO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVzZXJJbmZvID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fdXNlckluZm87XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Q29uZmlnID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fY29uZmlnO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEF2YWlsYWJsZUxhbmd1YWdlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2F2YWlsYWJsZUxhbmd1YWdlcztcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUb2tlbiA9IGZ1bmN0aW9uIChhY2Nlc3NUb2tlbikge1xuICAgICAgICBpZiAoIWFjY2Vzc1Rva2VuKSBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgndG9rZW4nKTtcbiAgICAgICAgZWxzZSBsb2NhbFN0b3JhZ2UudG9rZW4gPSBhY2Nlc3NUb2tlbjtcblxuICAgICAgICAvLyBzZXQgdGhlIHRva2VuIGNsb3N1cmVcbiAgICAgICAgdG9rZW4gPSBhY2Nlc3NUb2tlbjtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRUb2tlbiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLm1ha2VVUkwgPSBmdW5jdGlvbiAodXJsKSB7XG4gICAgICAgIGlmICh1cmwuaW5kZXhPZignPycpID09PSAtMSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXBpT3JpZ2luICsgdXJsICsgJz9hY2Nlc3NfdG9rZW49JyArIHRva2VuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXBpT3JpZ2luICsgdXJsICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIC8qXG4gICAgICogUmVzdCBBUEkgd3JhcHBlcnNcbiAgICAgKi9cbiAgICBDbGllbnQucHJvdG90eXBlLmNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCB8fCB0eXBlb2YgZGF0YSAhPT0gJ29iamVjdCcpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXNlckluZm8gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3Byb2ZpbGUnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwIHx8IHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JykgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGFuZ2VDbG91ZHJvbkF2YXRhciA9IGZ1bmN0aW9uIChhdmF0YXJGaWxlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZmQgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgZmQuYXBwZW5kKCdhdmF0YXInLCBhdmF0YXJGaWxlKTtcblxuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogdW5kZWZpbmVkIH0sXG4gICAgICAgICAgICB0cmFuc2Zvcm1SZXF1ZXN0OiBhbmd1bGFyLmlkZW50aXR5XG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9icmFuZGluZy9jbG91ZHJvbl9hdmF0YXInLCBmZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNoYW5nZUNsb3Vkcm9uTmFtZSA9IGZ1bmN0aW9uIChuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2JyYW5kaW5nL2Nsb3Vkcm9uX25hbWUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmluc3RhbGxBcHAgPSBmdW5jdGlvbiAoaWQsIG1hbmlmZXN0LCB0aXRsZSwgY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYXBwU3RvcmVJZDogaWQgKyAnQCcgKyBtYW5pZmVzdC52ZXJzaW9uLFxuICAgICAgICAgICAgbG9jYXRpb246IGNvbmZpZy5sb2NhdGlvbixcbiAgICAgICAgICAgIGRvbWFpbjogY29uZmlnLmRvbWFpbixcbiAgICAgICAgICAgIHBvcnRCaW5kaW5nczogY29uZmlnLnBvcnRCaW5kaW5ncyxcbiAgICAgICAgICAgIGFjY2Vzc1Jlc3RyaWN0aW9uOiBjb25maWcuYWNjZXNzUmVzdHJpY3Rpb24sXG4gICAgICAgICAgICBjZXJ0OiBjb25maWcuY2VydCxcbiAgICAgICAgICAgIGtleTogY29uZmlnLmtleSxcbiAgICAgICAgICAgIHNzbzogY29uZmlnLnNzbyxcbiAgICAgICAgICAgIG92ZXJ3cml0ZURuczogY29uZmlnLm92ZXJ3cml0ZURuc1xuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy9pbnN0YWxsJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5pZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNsb25lQXBwID0gZnVuY3Rpb24gKGFwcElkLCBjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbG9jYXRpb246IGNvbmZpZy5sb2NhdGlvbixcbiAgICAgICAgICAgIGRvbWFpbjogY29uZmlnLmRvbWFpbixcbiAgICAgICAgICAgIHBvcnRCaW5kaW5nczogY29uZmlnLnBvcnRCaW5kaW5ncyxcbiAgICAgICAgICAgIGJhY2t1cElkOiBjb25maWcuYmFja3VwSWRcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9jbG9uZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDEpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXN0b3JlQXBwID0gZnVuY3Rpb24gKGFwcElkLCBiYWNrdXBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7IGJhY2t1cElkOiBiYWNrdXBJZCB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL3Jlc3RvcmUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYmFja3VwQXBwID0gZnVuY3Rpb24gKGFwcElkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHt9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL2JhY2t1cCcsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51bmluc3RhbGxBcHAgPSBmdW5jdGlvbiAoYXBwSWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge307XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvdW5pbnN0YWxsJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNvbmZpZ3VyZUFwcCA9IGZ1bmN0aW9uIChpZCwgc2V0dGluZywgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBpZCArICcvY29uZmlndXJlLycgKyBzZXR0aW5nLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwICYmIHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVwYWlyQXBwID0gZnVuY3Rpb24gKGlkLCBkYXRhLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGlkICsgJy9yZXBhaXInLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwICYmIHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlQXBwID0gZnVuY3Rpb24gKGlkLCBtYW5pZmVzdCwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSAge1xuICAgICAgICAgICAgYXBwU3RvcmVJZDogbWFuaWZlc3QuaWQgKyAnQCcgKyBtYW5pZmVzdC52ZXJzaW9uLFxuICAgICAgICAgICAgc2tpcEJhY2t1cDogISFvcHRpb25zLnNraXBCYWNrdXBcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGlkICsgJy91cGRhdGUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc3RhcnRBcHAgPSBmdW5jdGlvbiAoaWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL3N0YXJ0Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zdG9wQXBwID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGlkICsgJy9zdG9wJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXN0YXJ0QXBwID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGlkICsgJy9yZXN0YXJ0Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5kZWJ1Z0FwcCA9IGZ1bmN0aW9uIChpZCwgc3RhdGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZGVidWdNb2RlOiBzdGF0ZSA/IHtcbiAgICAgICAgICAgICAgICByZWFkb25seVJvb3RmczogZmFsc2UsXG4gICAgICAgICAgICAgICAgY21kOiBbICcvYmluL2Jhc2gnLCAnLWMnLCAnZWNobyBcIlJlcGFpciBtb2RlLiBVc2UgdGhlIHdlYnRlcm1pbmFsIG9yIGNsb3Vkcm9uIGV4ZWMgdG8gcmVwYWlyLiBTbGVlcGluZ1wiICYmIHNsZWVwIGluZmluaXR5JyBdXG4gICAgICAgICAgICB9IDogbnVsbFxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL2NvbmZpZ3VyZS9kZWJ1Z19tb2RlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnZlcnNpb24gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL3N0YXR1cycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U3RhdHVzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9zdGF0dXMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwIHx8IHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JykgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRCYWNrdXBDb25maWcgPSBmdW5jdGlvbiAoYmFja3VwQ29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL2JhY2t1cF9jb25maWcnLCBiYWNrdXBDb25maWcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRCYWNrdXBDb25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL2JhY2t1cF9jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U3VwcG9ydENvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3Mvc3VwcG9ydF9jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RXh0ZXJuYWxMZGFwQ29uZmlnID0gZnVuY3Rpb24gKGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9leHRlcm5hbF9sZGFwX2NvbmZpZycsIGNvbmZpZywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEV4dGVybmFsTGRhcENvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvZXh0ZXJuYWxfbGRhcF9jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RGlyZWN0b3J5Q29uZmlnID0gZnVuY3Rpb24gKGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9kaXJlY3RvcnlfY29uZmlnJywgY29uZmlnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0RGlyZWN0b3J5Q29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9kaXJlY3RvcnlfY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBuZXR3b3JrXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRTeXNpbmZvQ29uZmlnID0gZnVuY3Rpb24gKGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9zeXNpbmZvX2NvbmZpZycsIGNvbmZpZywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFNlcnZlcklwID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9zZXJ2ZXJfaXAnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmlwKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U3lzaW5mb0NvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3Mvc3lzaW5mb19jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QmxvY2tsaXN0ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbmV0d29yay9ibG9ja2xpc3QnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmJsb2NrbGlzdCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldEJsb2NrbGlzdCA9IGZ1bmN0aW9uIChibG9ja2xpc3QsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbmV0d29yay9ibG9ja2xpc3QnLCB7IGJsb2NrbGlzdDogYmxvY2tsaXN0IH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXREeW5hbWljRG5zQ29uZmlnID0gZnVuY3Rpb24gKGVuYWJsZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvc2V0dGluZ3MvZHluYW1pY19kbnMnLCB7IGVuYWJsZWQ6IGVuYWJsZWQgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXREeW5hbWljRG5zQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9keW5hbWljX2RucycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBicmFuZGluZ1xuICAgIENsaWVudC5wcm90b3R5cGUuc2V0Rm9vdGVyID0gZnVuY3Rpb24gKGZvb3RlciwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9icmFuZGluZy9mb290ZXInLCB7IGZvb3RlcjogZm9vdGVyIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRGb290ZXIgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2JyYW5kaW5nL2Zvb3RlcicsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZm9vdGVyKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0VW5zdGFibGVBcHBzQ29uZmlnID0gZnVuY3Rpb24gKGVuYWJsZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvc2V0dGluZ3MvdW5zdGFibGVfYXBwcycsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVuc3RhYmxlQXBwc0NvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvdW5zdGFibGVfYXBwcycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmVuYWJsZWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRSZWdpc3RyeUNvbmZpZyA9IGZ1bmN0aW9uIChyYywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9yZWdpc3RyeV9jb25maWcnLCByYywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRSZWdpc3RyeUNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvcmVnaXN0cnlfY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRVcGRhdGVJbmZvID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmICghdGhpcy5fdXNlckluZm8uaXNBdExlYXN0QWRtaW4pIHJldHVybiBjYWxsYmFjayhuZXcgRXJyb3IoJ05vdCBhbGxvd2VkJykpO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi91cGRhdGUnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY2hlY2tGb3JVcGRhdGVzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vY2hlY2tfZm9yX3VwZGF0ZXMnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2xpZW50LnJlZnJlc2hDb25maWcoY2FsbGJhY2spO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRBdXRvdXBkYXRlUGF0dGVybiA9IGZ1bmN0aW9uIChwYXR0ZXJuLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL2F1dG91cGRhdGVfcGF0dGVybicsIHsgcGF0dGVybjogcGF0dGVybiB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXV0b3VwZGF0ZVBhdHRlcm4gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL2F1dG91cGRhdGVfcGF0dGVybicsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUaW1lWm9uZSA9IGZ1bmN0aW9uICh0aW1lWm9uZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy90aW1lX3pvbmUnLCB7IHRpbWVab25lOiB0aW1lWm9uZSB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0VGltZVpvbmUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL3RpbWVfem9uZScsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGltZVpvbmUpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRMYW5ndWFnZSA9IGZ1bmN0aW9uIChsYW5ndWFnZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9sYW5ndWFnZScsIHsgbGFuZ3VhZ2U6IGxhbmd1YWdlIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRMYW5ndWFnZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvbGFuZ3VhZ2UnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxhbmd1YWdlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0UmVtb3RlU3VwcG9ydCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc3VwcG9ydC9yZW1vdGVfc3VwcG9ydCcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmVuYWJsZVJlbW90ZVN1cHBvcnQgPSBmdW5jdGlvbiAoZW5hYmxlLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3N1cHBvcnQvcmVtb3RlX3N1cHBvcnQnLCB7IGVuYWJsZTogZW5hYmxlIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRCYWNrdXBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9iYWNrdXBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5iYWNrdXBzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TGF0ZXN0VGFza0J5VHlwZSA9IGZ1bmN0aW9uICh0eXBlLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdGFza3M/cGFnZT0xJnBlcl9wYWdlPTEmdHlwZT0nICsgdHlwZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrcy5sZW5ndGggPyBkYXRhLnRhc2tzWzBdIDogbnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFRhc2sgPSBmdW5jdGlvbiAodGFza0lkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdGFza3MvJyArIHRhc2tJZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFRhc2tMb2dzID0gZnVuY3Rpb24gKHRhc2tJZCwgZm9sbG93LCBsaW5lcywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGZvbGxvdykge1xuICAgICAgICAgICAgdmFyIGV2ZW50U291cmNlID0gbmV3IEV2ZW50U291cmNlKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS90YXNrcy8nICsgdGFza0lkICsgJy9sb2dzdHJlYW0/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgdGFza0lkICsgJy9sb2dzP2xpbmVzPScgKyBsaW5lcywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnN0YXJ0QmFja3VwID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYmFja3Vwcy9jcmVhdGUnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jbGVhbnVwQmFja3VwcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2JhY2t1cHMvY2xlYW51cCcsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRhc2tJZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnN0b3BUYXNrID0gZnVuY3Rpb24gKHRhc2tJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS90YXNrcy8nICsgdGFza0lkICsgJy9zdG9wJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXN0b3JlID0gZnVuY3Rpb24gKGJhY2t1cENvbmZpZywgYmFja3VwSWQsIHZlcnNpb24sIHN5c2luZm9Db25maWcsIHNraXBEbnNTZXR1cCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBiYWNrdXBDb25maWc6IGJhY2t1cENvbmZpZyxcbiAgICAgICAgICAgIGJhY2t1cElkOiBiYWNrdXBJZCxcbiAgICAgICAgICAgIHZlcnNpb246IHZlcnNpb24sXG4gICAgICAgICAgICBzeXNpbmZvQ29uZmlnOiBzeXNpbmZvQ29uZmlnLFxuICAgICAgICAgICAgc2tpcERuc1NldHVwOiBza2lwRG5zU2V0dXBcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3Jlc3RvcmUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cykpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuaW1wb3J0QmFja3VwID0gZnVuY3Rpb24gKGFwcElkLCBiYWNrdXBJZCwgYmFja3VwRm9ybWF0LCBiYWNrdXBDb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYmFja3VwSWQ6IGJhY2t1cElkLFxuICAgICAgICAgICAgYmFja3VwRm9ybWF0OiBiYWNrdXBGb3JtYXQsXG4gICAgICAgICAgICBiYWNrdXBDb25maWc6IGJhY2t1cENvbmZpZyxcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9pbXBvcnQnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cykpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Tm90aWZpY2F0aW9ucyA9IGZ1bmN0aW9uIChvcHRpb25zLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5hY2tub3dsZWRnZWQgPT09ICdib29sZWFuJykgY29uZmlnLnBhcmFtcy5hY2tub3dsZWRnZWQgPSBvcHRpb25zLmFja25vd2xlZGdlZDtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbm90aWZpY2F0aW9ucycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5ub3RpZmljYXRpb25zKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYWNrTm90aWZpY2F0aW9uID0gZnVuY3Rpb24gKG5vdGlmaWNhdGlvbklkLCBhY2tub3dsZWRnZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbm90aWZpY2F0aW9ucy8nICsgbm90aWZpY2F0aW9uSWQsIHsgYWNrbm93bGVkZ2VkOiBhY2tub3dsZWRnZWQgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEV2ZW50ID0gZnVuY3Rpb24gKGV2ZW50SWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9ldmVudGxvZy8nICsgZXZlbnRJZCwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRFdmVudExvZ3MgPSBmdW5jdGlvbiAoYWN0aW9ucywgc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogYWN0aW9ucyxcbiAgICAgICAgICAgICAgICBzZWFyY2g6IHNlYXJjaCxcbiAgICAgICAgICAgICAgICBwYWdlOiBwYWdlLFxuICAgICAgICAgICAgICAgIHBlcl9wYWdlOiBwZXJQYWdlXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL2V2ZW50bG9nJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmV2ZW50bG9ncyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFBsYXRmb3JtTG9ncyA9IGZ1bmN0aW9uICh1bml0LCBmb2xsb3csIGxpbmVzLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoZm9sbG93KSB7XG4gICAgICAgICAgICB2YXIgZXZlbnRTb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UoY2xpZW50LmFwaU9yaWdpbiArICcvYXBpL3YxL2Nsb3Vkcm9uL2xvZ3N0cmVhbS8nICsgdW5pdCArICc/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9sb2dzLycgKyB1bml0ICsgJz9saW5lcz0nICsgbGluZXMsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2aWNlTG9ncyA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgZm9sbG93LCBsaW5lcywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGZvbGxvdykge1xuICAgICAgICAgICAgdmFyIGV2ZW50U291cmNlID0gbmV3IEV2ZW50U291cmNlKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUgKyAnL2xvZ3N0cmVhbT9saW5lcz0nICsgbGluZXMgKyAnJmFjY2Vzc190b2tlbj0nICsgdG9rZW4pO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZXZlbnRTb3VyY2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZ2V0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSArICcvbG9ncz9saW5lcz0nICsgbGluZXMsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIHZhciBhcHBzID0gZGF0YS5hcHBzO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcHBzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhhdC5fYXBwUG9zdFByb2Nlc3MoYXBwc1tpXSk7IC8vIHRoaXMgd2lsbCBhbHNvIHNldCB0aGUgY29ycmVjdCBpY29uVXJsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGFwcHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBMb2dzID0gZnVuY3Rpb24gKGFwcElkLCBmb2xsb3csIGxpbmVzLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoZm9sbG93KSB7XG4gICAgICAgICAgICB2YXIgZXZlbnRTb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UoY2xpZW50LmFwaU9yaWdpbiArICcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9sb2dzdHJlYW0/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvbG9ncycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBCYWNrdXBzID0gZnVuY3Rpb24gKGFwcElkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL2JhY2t1cHMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmJhY2t1cHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2aWNlcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2VydmljZXMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnNlcnZpY2VzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5zZXJ2aWNlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY29uZmlndXJlU2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXN0YXJ0U2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUgKyAnL3Jlc3RhcnQnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlYnVpbGRTZXJ2aWNlID0gZnVuY3Rpb24gKHNlcnZpY2VOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSArICcvcmVidWlsZCcsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0VXNlcnMgPSBmdW5jdGlvbiAoc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAodHlwZW9mIHNlYXJjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FsbGJhY2sgPSBzZWFyY2g7XG4gICAgICAgICAgICBzZWFyY2ggPSAnJztcbiAgICAgICAgICAgIHBhZ2UgPSAxO1xuICAgICAgICAgICAgcGVyUGFnZSA9IDUwMDA7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChzZWFyY2gpIGNvbmZpZy5wYXJhbXMuc2VhcmNoID0gc2VhcmNoO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS91c2VycycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS51c2Vycyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVzZXIgPSBmdW5jdGlvbiAodXNlcklkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEdyb3VwcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvZ3JvdXBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5ncm91cHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRHcm91cHMgPSBmdW5jdGlvbiAodXNlcklkLCBncm91cElkcywgY2FsbGJhY2spIHtcbiAgICAgICAgcHV0KCcvYXBpL3YxL3VzZXJzLycgKyB1c2VySWQgKyAnL2dyb3VwcycsIHsgZ3JvdXBJZHM6IGdyb3VwSWRzIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRHcm91cCA9IGZ1bmN0aW9uIChncm91cElkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvZ3JvdXBzLycgKyBncm91cElkLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY3JlYXRlR3JvdXAgPSBmdW5jdGlvbiAobmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBuYW1lOiBuYW1lXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9ncm91cHMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlR3JvdXAgPSBmdW5jdGlvbiAoaWQsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbmFtZTogbmFtZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvZ3JvdXBzLycgKyBpZCwgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldEdyb3VwTWVtYmVycyA9IGZ1bmN0aW9uIChpZCwgdXNlcklkcywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICB1c2VySWRzOiB1c2VySWRzXG5cbiAgICAgICAgfTtcblxuICAgICAgICBwdXQoJy9hcGkvdjEvZ3JvdXBzLycgKyBpZCArICcvbWVtYmVycycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVHcm91cCA9IGZ1bmN0aW9uIChncm91cElkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgZGF0YToge30sXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGRlbCgnL2FwaS92MS9ncm91cHMvJyArIGdyb3VwSWQsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcCA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgdGhhdC5fYXBwUG9zdFByb2Nlc3MoZGF0YSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBXaXRoVGFzayA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIHRoaXMuZ2V0QXBwKGFwcElkLCBmdW5jdGlvbiAoZXJyb3IsIGFwcCkge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICBpZiAoIWFwcC50YXNrSWQpIHJldHVybiBjYWxsYmFjayhudWxsLCBhcHApO1xuXG4gICAgICAgICAgICB0aGF0LmdldFRhc2soYXBwLnRhc2tJZCwgZnVuY3Rpb24gKGVycm9yLCB0YXNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnByb2dyZXNzID0gdGFzay5wZXJjZW50O1xuICAgICAgICAgICAgICAgICAgICBhcHAubWVzc2FnZSA9IHRhc2subWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gbW9tZW50LmR1cmF0aW9uKG1vbWVudC51dGMoKS5kaWZmKG1vbWVudC51dGModGFzay5jcmVhdGlvblRpbWUpKSkuYXNNaW51dGVzKCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnByb2dyZXNzID0gMDtcbiAgICAgICAgICAgICAgICAgICAgYXBwLm1lc3NhZ2UgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gMDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBhcHApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldENhY2hlZEFwcFN5bmMgPSBmdW5jdGlvbiAoYXBwSWQpIHtcbiAgICAgICAgdmFyIGFwcEZvdW5kID0gbnVsbDtcbiAgICAgICAgdGhpcy5faW5zdGFsbGVkQXBwcy5zb21lKGZ1bmN0aW9uIChhcHApIHtcbiAgICAgICAgICAgIGlmIChhcHAuaWQgPT09IGFwcElkKSB7XG4gICAgICAgICAgICAgICAgYXBwRm91bmQgPSBhcHA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGFwcEZvdW5kO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZUludml0ZSA9IGZ1bmN0aW9uICh1c2VySWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvY3JlYXRlX2ludml0ZScsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2VuZEludml0ZSA9IGZ1bmN0aW9uICh1c2VySWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvc2VuZF9pbnZpdGUnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmRpc2FibGVUd29GYWN0b3JBdXRoZW50aWNhdGlvbkJ5VXNlcklkID0gZnVuY3Rpb24gKHVzZXJJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS91c2Vycy8nICsgdXNlcklkICsgJy90d29mYWN0b3JhdXRoZW50aWNhdGlvbl9kaXNhYmxlJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXR1cCA9IGZ1bmN0aW9uIChkYXRhLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3NldHVwJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZUFkbWluID0gZnVuY3Rpb24gKGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL2FjdGl2YXRlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCByZXN1bHQsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgcmVzdWx0KSk7XG5cbiAgICAgICAgICAgIHRoYXQuc2V0VG9rZW4ocmVzdWx0LnRva2VuKTtcbiAgICAgICAgICAgIHRoYXQuc2V0VXNlckluZm8oeyB1c2VybmFtZTogZGF0YS51c2VybmFtZSwgZW1haWw6IGRhdGEuZW1haWwsIGFkbWluOiB0cnVlLCB0d29GYWN0b3JBdXRoZW50aWNhdGlvbkVuYWJsZWQ6IGZhbHNlLCBzb3VyY2U6ICcnLCBhdmF0YXJVcmw6IG51bGwgfSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdC5hY3RpdmF0ZWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRUb2tlbnMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3Rva2Vucy8nLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRva2Vucyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZVRva2VuID0gZnVuY3Rpb24gKG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbmFtZTogbmFtZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdG9rZW5zJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBGSVhNRSBjbGFzaGVzIHdpdGggZXhpc3RpbmcgZ2V0VG9rZW4oKVxuICAgIC8vIENsaWVudC5wcm90b3R5cGUuZ2V0VG9rZW4gPSBmdW5jdGlvbiAoaWQsIGNhbGxiYWNrKSB7XG4gICAgLy8gICAgIGdldCgnL2FwaS92MS90b2tlbnMvJyArIGlkLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgIC8vICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgIC8vICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgLy8gICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRva2VuKTtcbiAgICAvLyAgICAgfSk7XG4gICAgLy8gfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZGVsVG9rZW4gPSBmdW5jdGlvbiAodG9rZW5JZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZGVsKCcvYXBpL3YxL3Rva2Vucy8nICsgdG9rZW5JZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmFkZEFwcFBhc3N3b3JkID0gZnVuY3Rpb24gKGlkZW50aWZpZXIsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgaWRlbnRpZmllcjogaWRlbnRpZmllcixcbiAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcF9wYXNzd29yZHMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwUGFzc3dvcmRzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBfcGFzc3dvcmRzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmRlbEFwcFBhc3N3b3JkID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgICAgICBkZWwoJy9hcGkvdjEvYXBwX3Bhc3N3b3Jkcy8nICsgaWQsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBza2lwQmFja3VwOiAhIW9wdGlvbnMuc2tpcEJhY2t1cFxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vdXBkYXRlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5pc1JlYm9vdFJlcXVpcmVkID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9yZWJvb3QnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnJlYm9vdFJlcXVpcmVkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVib290ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vcmVib290Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRDZXJ0aWZpY2F0ZSA9IGZ1bmN0aW9uIChjZXJ0aWZpY2F0ZUZpbGUsIGtleUZpbGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgY2VydDogY2VydGlmaWNhdGVGaWxlLFxuICAgICAgICAgICAga2V5OiBrZXlGaWxlXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9jZXJ0aWZpY2F0ZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5kaXNrcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvY2xvdWRyb24vZGlza3MnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUubWVtb3J5ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9tZW1vcnknLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ3JhcGhzID0gZnVuY3Rpb24gKHRhcmdldHMsIGZyb20sIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgICAgIC8vIGlmIHdlIGhhdmUgYSBsb3Qgb2YgYXBwcywgdGFyZ2V0cyBjYW4gYmUgdmVyeSBsYXJnZS4gbm9kZSB3aWxsIGp1c3QgZGlzY29ubmVjdCBzaW5jZSBpdCBleGNlZWRzIGhlYWRlciBzaXplXG4gICAgICAgIHZhciBzaXplID0gMTAsIGNodW5rcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhcmdldHMubGVuZ3RoOyBpICs9IHNpemUpIHtcbiAgICAgICAgICAgIGNodW5rcy5wdXNoKHRhcmdldHMuc2xpY2UoaSwgaStzaXplKSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGFzeW5jLmVhY2hTZXJpZXMoY2h1bmtzLCBmdW5jdGlvbiAoY2h1bmssIGl0ZXJhdG9yQ2FsbGJhY2spIHtcbiAgICAgICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogY2h1bmssXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdDogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICBmcm9tOiBmcm9tLFxuICAgICAgICAgICAgICAgICAgICB1bnRpbDogJ25vdydcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5ub051bGxQb2ludHMpIGNvbmZpZy5wYXJhbXMubm9OdWxsUG9pbnRzID0gdHJ1ZTtcblxuICAgICAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL2dyYXBocycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBpdGVyYXRvckNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBpdGVyYXRvckNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIC8vIHRoZSBkYXRhcG9pbnQgcmV0dXJuZWQgaGVyZSBpcyBhbiBbdmFsdWUsIHRpbWVzdGFtcF1cbiAgICAgICAgICAgICAgICByZXN1bHQgPSByZXN1bHQuY29uY2F0KGRhdGEpO1xuICAgICAgICAgICAgICAgIGl0ZXJhdG9yQ2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24gaXRlcmF0b3JEb25lKGVycm9yKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY3JlYXRlVGlja2V0ID0gZnVuY3Rpb24gKHRpY2tldCwgY2FsbGJhY2spIHtcbiAgICAgICAgLy8ganVzdCB0byBiZSBlcGxpY2l0IGhlcmVcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBlbmFibGVTc2hTdXBwb3J0OiAhIXRpY2tldC5lbmFibGVTc2hTdXBwb3J0LFxuICAgICAgICAgICAgdHlwZTogdGlja2V0LnR5cGUsXG4gICAgICAgICAgICBzdWJqZWN0OiB0aWNrZXQuc3ViamVjdCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0aWNrZXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgICBhcHBJZDogdGlja2V0LmFwcElkIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGFsdEVtYWlsOiB0aWNrZXQuYWx0RW1haWwgfHwgdW5kZWZpbmVkXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9zdXBwb3J0L3RpY2tldCcsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDEpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jcmVhdGVVc2VyID0gZnVuY3Rpb24gKHVzZXIsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZW1haWw6IHVzZXIuZW1haWwsXG4gICAgICAgICAgICBkaXNwbGF5TmFtZTogdXNlci5kaXNwbGF5TmFtZSxcbiAgICAgICAgICAgIHJvbGU6IHVzZXIucm9sZVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh1c2VyLnVzZXJuYW1lICE9PSBudWxsKSBkYXRhLnVzZXJuYW1lID0gdXNlci51c2VybmFtZTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3VzZXJzJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnVwZGF0ZVVzZXIgPSBmdW5jdGlvbiAodXNlciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBlbWFpbDogdXNlci5lbWFpbCxcbiAgICAgICAgICAgIGRpc3BsYXlOYW1lOiB1c2VyLmRpc3BsYXlOYW1lLFxuICAgICAgICAgICAgZmFsbGJhY2tFbWFpbDogdXNlci5mYWxsYmFja0VtYWlsLFxuICAgICAgICAgICAgYWN0aXZlOiB1c2VyLmFjdGl2ZSxcbiAgICAgICAgICAgIHJvbGU6IHVzZXIucm9sZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXIuaWQsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGFuZ2VPd25lcnNoaXAgPSBmdW5jdGlvbiAodXNlcklkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3VzZXJzLycgKyB1c2VySWQgKyAnL21ha2Vfb3duZXInLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlbW92ZVVzZXIgPSBmdW5jdGlvbiAodXNlcklkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgZGF0YToge30sXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGRlbCgnL2FwaS92MS91c2Vycy8nICsgdXNlcklkLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVQcm9maWxlID0gZnVuY3Rpb24gKGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jbGVhckF2YXRhciA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBkZWwoJy9hcGkvdjEvcHJvZmlsZS9hdmF0YXInLCB7fSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGFuZ2VBdmF0YXIgPSBmdW5jdGlvbiAoYXZhdGFyRmlsZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGZkID0gbmV3IEZvcm1EYXRhKCk7XG4gICAgICAgIGZkLmFwcGVuZCgnYXZhdGFyJywgYXZhdGFyRmlsZSk7XG5cbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6IHVuZGVmaW5lZCB9LFxuICAgICAgICAgICAgdHJhbnNmb3JtUmVxdWVzdDogYW5ndWxhci5pZGVudGl0eVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS9hdmF0YXInLCBmZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNoYW5nZVBhc3N3b3JkID0gZnVuY3Rpb24gKGN1cnJlbnRQYXNzd29yZCwgbmV3UGFzc3dvcmQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgcGFzc3dvcmQ6IGN1cnJlbnRQYXNzd29yZCxcbiAgICAgICAgICAgIG5ld1Bhc3N3b3JkOiBuZXdQYXNzd29yZFxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS9wYXNzd29yZCcsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUd29GYWN0b3JBdXRoZW50aWNhdGlvblNlY3JldCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHt9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS90d29mYWN0b3JhdXRoZW50aWNhdGlvbl9zZWNyZXQnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZW5hYmxlVHdvRmFjdG9yQXV0aGVudGljYXRpb24gPSBmdW5jdGlvbiAodG90cFRva2VuLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIHRvdHBUb2tlbjogdG90cFRva2VuXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9wcm9maWxlL3R3b2ZhY3RvcmF1dGhlbnRpY2F0aW9uX2VuYWJsZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5kaXNhYmxlVHdvRmFjdG9yQXV0aGVudGljYXRpb24gPSBmdW5jdGlvbiAocGFzc3dvcmQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgcGFzc3dvcmQ6IHBhc3N3b3JkXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9wcm9maWxlL3R3b2ZhY3RvcmF1dGhlbnRpY2F0aW9uX2Rpc2FibGUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc3RhcnRFeHRlcm5hbExkYXBTeW5jID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vc3luY19leHRlcm5hbF9sZGFwJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGFza0lkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0VXNlckFjdGl2ZSA9IGZ1bmN0aW9uICh1c2VySWQsIGFjdGl2ZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBhY3RpdmU6IGFjdGl2ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvYWN0aXZlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlZnJlc2hVc2VySW5mbyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgY2FsbGJhY2sgPSB0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicgPyBjYWxsYmFjayA6IGZ1bmN0aW9uICgpIHt9O1xuXG4gICAgICAgIHRoaXMudXNlckluZm8oZnVuY3Rpb24gKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcblxuICAgICAgICAgICAgdGhhdC5zZXRVc2VySW5mbyhyZXN1bHQpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlZnJlc2hDb25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGNhbGxiYWNrID0gdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nID8gY2FsbGJhY2sgOiBmdW5jdGlvbiAoKSB7fTtcblxuICAgICAgICB0aGlzLmNvbmZpZyhmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICB0aGF0LmdldFVwZGF0ZUluZm8oZnVuY3Rpb24gKGVycm9yLCBpbmZvKSB7IC8vIG5vdGU6IG5vbi1hZG1pbiB1c2VycyBtYXkgZ2V0IGFjY2VzcyBkZW5pZWQgZm9yIHRoaXNcbiAgICAgICAgICAgICAgICBpZiAoIWVycm9yKSByZXN1bHQudXBkYXRlID0gaW5mby51cGRhdGU7IC8vIGF0dGFjaCB1cGRhdGUgaW5mb3JtYXRpb24gdG8gY29uZmlnIG9iamVjdFxuXG4gICAgICAgICAgICAgICAgdGhhdC5zZXRDb25maWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZWZyZXNoQXZhaWxhYmxlTGFuZ3VhZ2VzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBnZXQoJy9hcGkvdjEvY2xvdWRyb24vbGFuZ3VhZ2VzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgYW5ndWxhci5jb3B5KGRhdGEubGFuZ3VhZ2VzLCB0aGF0Ll9hdmFpbGFibGVMYW5ndWFnZXMpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxhbmd1YWdlcyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLl9hcHBQb3N0UHJvY2VzcyA9IGZ1bmN0aW9uIChhcHApIHtcbiAgICAgICAgLy8gY2FsY3VsYXRlIHRoZSBpY29uIHBhdGhzXG4gICAgICAgIGFwcC5pY29uVXJsID0gYXBwLmljb25VcmwgPyAodGhpcy5hcGlPcmlnaW4gKyBhcHAuaWNvblVybCArICc/YWNjZXNzX3Rva2VuPScgKyB0b2tlbiArICcmdHM9JyArIGFwcC50cykgOiBudWxsO1xuXG4gICAgICAgIC8vIGFtZW5kIHRoZSBwb3N0IGluc3RhbGwgY29uZmlybSBzdGF0ZVxuICAgICAgICBhcHAucGVuZGluZ1Bvc3RJbnN0YWxsQ29uZmlybWF0aW9uID0gISFsb2NhbFN0b3JhZ2VbJ2NvbmZpcm1Qb3N0SW5zdGFsbF8nICsgYXBwLmlkXTtcblxuICAgICAgICBpZiAoYXBwLm1hbmlmZXN0LmRlc2NyaXB0aW9uKSB7IC8vIGNhbiBiZSBlbXB0eSBmb3IgZGV2IGFwcHNcbiAgICAgICAgICAgIHZhciB0bXAgPSBhcHAubWFuaWZlc3QuZGVzY3JpcHRpb24ubWF0Y2goL1xcPHVwc3RyZWFtXFw+KC4qKVxcPFxcL3Vwc3RyZWFtXFw+L2kpO1xuICAgICAgICAgICAgYXBwLnVwc3RyZWFtVmVyc2lvbiA9ICh0bXAgJiYgdG1wWzFdKSA/IHRtcFsxXSA6ICcnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXBwLnVwc3RyZWFtVmVyc2lvbiA9ICcnO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFhcHAubWFuaWZlc3QudGl0bGUpIGFwcC5tYW5pZmVzdC50aXRsZSA9ICdVbnRpdGxlZCc7XG5cbiAgICAgICAgaWYgKGFwcC5tYW5pZmVzdC5wb3N0SW5zdGFsbE1lc3NhZ2UpIHtcbiAgICAgICAgICAgIHZhciB0ZXh0PSBhcHAubWFuaWZlc3QucG9zdEluc3RhbGxNZXNzYWdlO1xuICAgICAgICAgICAgLy8gd2UgY2hvc2UgLSBiZWNhdXNlIHVuZGVyc2NvcmUgaGFzIHNwZWNpYWwgbWVhbmluZyBpbiBtYXJrZG93blxuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBQLUxPQ0FUSU9OL2csIGFwcC5sb2NhdGlvbik7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1BUFAtRE9NQUlOL2csIGFwcC5kb21haW4pO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBQLUZRRE4vZywgYXBwLmZxZG4pO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBQLU9SSUdJTi9nLCAnaHR0cHM6Ly8nICsgYXBwLmZxZG4pO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBJLURPTUFJTi9nLCB0aGlzLl9jb25maWcuYWRtaW5GcWRuKTtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcJENMT1VEUk9OLUFQSS1PUklHSU4vZywgJ2h0dHBzOi8vJyArIHRoaXMuX2NvbmZpZy5hZG1pbkZxZG4pO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tVVNFUk5BTUUvZywgdGhpcy5fdXNlckluZm8udXNlcm5hbWUpO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBQLUlEL2csIGFwcC5pZCk7XG5cbiAgICAgICAgICAgIC8vIFteXSBtYXRjaGVzIGV2ZW4gbmV3bGluZXMuICc/JyBtYWtlcyBpdCBub24tZ3JlZWR5XG4gICAgICAgICAgICBpZiAoYXBwLnNzbykgdGV4dCA9IHRleHQucmVwbGFjZSgvPG5vc3NvPlteXSo/PFxcL25vc3NvPi9nLCAnJyk7XG4gICAgICAgICAgICBlbHNlIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxzc28+W15dKj88XFwvc3NvPi9nLCAnJyk7XG5cbiAgICAgICAgICAgIGFwcC5tYW5pZmVzdC5wb3N0SW5zdGFsbE1lc3NhZ2UgPSB0ZXh0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGFwcDtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBwcmVkKSB7XG4gICAgICAgIHZhciBsbyA9IC0xLCBoaSA9IGFycmF5Lmxlbmd0aDtcbiAgICAgICAgd2hpbGUgKDEgKyBsbyAhPT0gaGkpIHtcbiAgICAgICAgICAgIHZhciBtaSA9IGxvICsgKChoaSAtIGxvKSA+PiAxKTtcbiAgICAgICAgICAgIGlmIChwcmVkKGFycmF5W21pXSkpIHtcbiAgICAgICAgICAgICAgICBoaSA9IG1pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsbyA9IG1pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoaTtcbiAgICB9XG5cbiAgICBDbGllbnQucHJvdG90eXBlLl91cGRhdGVBcHBDYWNoZSA9IGZ1bmN0aW9uIChhcHApIHtcbiAgICAgICAgdmFyIHRtcCA9IHt9O1xuICAgICAgICBhbmd1bGFyLmNvcHkoYXBwLCB0bXApO1xuXG4gICAgICAgIHZhciBmb3VuZEluZGV4ID0gdGhpcy5faW5zdGFsbGVkQXBwcy5maW5kSW5kZXgoZnVuY3Rpb24gKGEpIHsgcmV0dXJuIGEuaWQgPT09IGFwcC5pZDsgfSk7XG5cbiAgICAgICAgLy8gd2UgcmVwbGFjZSBuZXcgZGF0YSBpbnRvIHRoZSBleGlzdGluZyByZWZlcmVuY2UgdG8ga2VlcCBhbmd1bGFyIGJpbmRpbmdzXG4gICAgICAgIGlmIChmb3VuZEluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgYW5ndWxhci5jb3B5KHRtcCwgdGhpcy5faW5zdGFsbGVkQXBwc1tmb3VuZEluZGV4XSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9pbnN0YWxsZWRBcHBzLnB1c2godG1wKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGFkZCByZWZlcmVuY2UgdG8gb2JqZWN0IG1hcCB3aXRoIGFwcElkIGtleXNcbiAgICAgICAgdGhpcy5faW5zdGFsbGVkQXBwc0J5SWRbYXBwLmlkXSA9IHRoaXMuX2luc3RhbGxlZEFwcHNbZm91bmRJbmRleF07XG5cbiAgICAgICAgLy8gVE9ETyB0aGlzIG5vdCB2ZXJ5IGVsZWdhbnRcbiAgICAgICAgLy8gdXBkYXRlIGFwcCB0YWdzXG4gICAgICAgIHRtcCA9IHRoaXMuX2luc3RhbGxlZEFwcHNcbiAgICAgICAgICAgIC5tYXAoZnVuY3Rpb24gKGFwcCkgeyByZXR1cm4gYXBwLnRhZ3MgfHwgW107IH0pICAgICAgICAgICAgICAgICAgICAgLy8gcmV0dXJuIGFycmF5IG9mIGFycmF5c1xuICAgICAgICAgICAgLnJlZHVjZShmdW5jdGlvbiAoYSwgaSkgeyByZXR1cm4gYS5jb25jYXQoaSk7IH0sIFtdKSAgICAgICAgICAgICAgICAvLyBtZXJnZSBhbGwgYXJyYXlzIGludG8gb25lXG4gICAgICAgICAgICAuZmlsdGVyKGZ1bmN0aW9uICh2LCBpLCBzZWxmKSB7IHJldHVybiBzZWxmLmluZGV4T2YodikgPT09IGk7IH0pICAgIC8vIGZpbHRlciBkdXBsaWNhdGVzXG4gICAgICAgICAgICAuc29ydChmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYS5sb2NhbGVDb21wYXJlKGIpOyB9KTsgICAgICAgICAgICAgIC8vIHNvcnRcblxuICAgICAgICAvLyBrZWVwIHRhZyBhcnJheSByZWZlcmVuY2VzXG4gICAgICAgIGFuZ3VsYXIuY29weSh0bXAsIHRoaXMuX2FwcFRhZ3MpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlZnJlc2hJbnN0YWxsZWRBcHBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGNhbGxiYWNrID0gY2FsbGJhY2sgfHwgZnVuY3Rpb24gKGVycm9yKSB7IGlmIChlcnJvcikgY29uc29sZS5lcnJvcihlcnJvcik7IH07XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICB0aGlzLmdldEFwcHMoZnVuY3Rpb24gKGVycm9yLCBhcHBzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgIGFzeW5jLmVhY2hMaW1pdChhcHBzLCAyMCwgZnVuY3Rpb24gKGFwcCwgaXRlcmF0b3JDYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIGFwcC5zc29BdXRoID0gKGFwcC5tYW5pZmVzdC5hZGRvbnNbJ2xkYXAnXSB8fCBhcHAubWFuaWZlc3QuYWRkb25zWydwcm94eUF1dGgnXSkgJiYgYXBwLnNzbztcblxuICAgICAgICAgICAgICAgIC8vIG9ubHkgZmV0Y2ggaWYgd2UgaGF2ZSBwZXJtaXNzaW9uc1xuICAgICAgICAgICAgICAgIGlmICghdGhhdC5fdXNlckluZm8uaXNBdExlYXN0QWRtaW4pIHtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnByb2dyZXNzID0gMDtcbiAgICAgICAgICAgICAgICAgICAgYXBwLm1lc3NhZ2UgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gMDtcblxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll91cGRhdGVBcHBDYWNoZShhcHApO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpdGVyYXRvckNhbGxiYWNrKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGdldFRhc2tGdW5jID0gYXBwLnRhc2tJZCA/IHRoYXQuZ2V0VGFzay5iaW5kKG51bGwsIGFwcC50YXNrSWQpIDogZnVuY3Rpb24gKG5leHQpIHsgcmV0dXJuIG5leHQoKTsgfTtcbiAgICAgICAgICAgICAgICBnZXRUYXNrRnVuYyhmdW5jdGlvbiAoZXJyb3IsIHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gaXRlcmF0b3JDYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC5wcm9ncmVzcyA9IHRhc2sucGVyY2VudDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC5tZXNzYWdlID0gdGFzay5tZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gbW9tZW50LmR1cmF0aW9uKG1vbWVudC51dGMoKS5kaWZmKG1vbWVudC51dGModGFzay5jcmVhdGlvblRpbWUpKSkuYXNNaW51dGVzKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhcHAucHJvZ3Jlc3MgPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBwLm1lc3NhZ2UgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC50YXNrTWludXRlc0FjdGl2ZSA9IDA7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll91cGRhdGVBcHBDYWNoZShhcHApO1xuXG4gICAgICAgICAgICAgICAgICAgIGl0ZXJhdG9yQ2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIGl0ZXJhdG9yRG9uZShlcnJvcikge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcblxuICAgICAgICAgICAgICAgIC8vIGZpbHRlciBvdXQgb2xkIGFwcHMsIGdvaW5nIGJhY2t3YXJkcyB0byBhbGxvdyBzcGxpY2luZ1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSB0aGF0Ll9pbnN0YWxsZWRBcHBzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghYXBwcy5zb21lKGZ1bmN0aW9uIChlbGVtKSB7IHJldHVybiAoZWxlbS5pZCA9PT0gdGhhdC5faW5zdGFsbGVkQXBwc1tpXS5pZCk7IH0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVtb3ZlZCA9IHRoYXQuX2luc3RhbGxlZEFwcHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHRoYXQuX2luc3RhbGxlZEFwcHNCeUlkW3JlbW92ZWRbMF0uaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUubG9naW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuc2V0VG9rZW4obnVsbCk7XG5cbiAgICAgICAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSAnL2xvZ2luLmh0bWw/cmV0dXJuVG89LycgKyBlbmNvZGVVUklDb21wb25lbnQod2luZG93LmxvY2F0aW9uLmhhc2gpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmxvZ291dCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHRva2VuID0gdGhpcy5nZXRUb2tlbigpO1xuICAgICAgICB0aGlzLnNldFRva2VuKG51bGwpO1xuXG4gICAgICAgIC8vIGludmFsaWRhdGVzIHRoZSB0b2tlblxuICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9IGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9jbG91ZHJvbi9sb2dvdXQ/YWNjZXNzX3Rva2VuPScgKyB0b2tlbjtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGxvYWRGaWxlID0gZnVuY3Rpb24gKGFwcElkLCBmaWxlLCBwcm9ncmVzc0NhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZmQgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgZmQuYXBwZW5kKCdmaWxlJywgZmlsZSk7XG5cbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6IHVuZGVmaW5lZCB9LFxuICAgICAgICAgICAgdHJhbnNmb3JtUmVxdWVzdDogYW5ndWxhci5pZGVudGl0eSxcbiAgICAgICAgICAgIHVwbG9hZEV2ZW50SGFuZGxlcnM6IHtcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogcHJvZ3Jlc3NDYWxsYmFja1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL3VwbG9hZD9maWxlPScgKyBlbmNvZGVVUklDb21wb25lbnQoJy90bXAvJyArIGZpbGUubmFtZSksIGZkLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGVja0Rvd25sb2FkYWJsZUZpbGUgPSBmdW5jdGlvbiAoYXBwSWQsIGZpbGVQYXRoLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogdW5kZWZpbmVkIH1cbiAgICAgICAgfTtcblxuICAgICAgICBoZWFkKCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9kb3dubG9hZD9maWxlPScgKyBlbmNvZGVVUklDb21wb25lbnQoZmlsZVBhdGgpLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZW5kVGVzdE1haWwgPSBmdW5jdGlvbiAoZG9tYWluLCB0bywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICB0bzogdG9cbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvc2VuZF90ZXN0X21haWwnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIERvbWFpbnNcbiAgICBDbGllbnQucHJvdG90eXBlLmdldERvbWFpbnMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2RvbWFpbnMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmRvbWFpbnMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXREb21haW4gPSBmdW5jdGlvbiAoZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvZG9tYWlucy8nICsgZG9tYWluLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY2hlY2tETlNSZWNvcmRzID0gZnVuY3Rpb24gKGRvbWFpbiwgc3ViZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvZG9tYWlucy8nICsgZG9tYWluICsgJy9kbnNfY2hlY2s/c3ViZG9tYWluPScgKyBzdWJkb21haW4sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5hZGREb21haW4gPSBmdW5jdGlvbiAoZG9tYWluLCB6b25lTmFtZSwgcHJvdmlkZXIsIGNvbmZpZywgZmFsbGJhY2tDZXJ0aWZpY2F0ZSwgdGxzQ29uZmlnLCB3ZWxsS25vd24sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZG9tYWluOiBkb21haW4sXG4gICAgICAgICAgICBwcm92aWRlcjogcHJvdmlkZXIsXG4gICAgICAgICAgICBjb25maWc6IGNvbmZpZyxcbiAgICAgICAgICAgIHRsc0NvbmZpZzogdGxzQ29uZmlnLFxuICAgICAgICAgICAgd2VsbEtub3duOiB3ZWxsS25vd25cbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHpvbmVOYW1lKSBkYXRhLnpvbmVOYW1lID0gem9uZU5hbWU7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBpZiAoZmFsbGJhY2tDZXJ0aWZpY2F0ZSkgZGF0YS5mYWxsYmFja0NlcnRpZmljYXRlID0gZmFsbGJhY2tDZXJ0aWZpY2F0ZTtcblxuICAgICAgICAvLyBoYWNrIHVudGlsIHdlIGZpeCB0aGUgZG9tYWlucy5qc1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2RvbWFpbnMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVEb21haW4gPSBmdW5jdGlvbiAoZG9tYWluLCB6b25lTmFtZSwgcHJvdmlkZXIsIGNvbmZpZywgZmFsbGJhY2tDZXJ0aWZpY2F0ZSwgdGxzQ29uZmlnLCB3ZWxsS25vd24sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgcHJvdmlkZXI6IHByb3ZpZGVyLFxuICAgICAgICAgICAgY29uZmlnOiBjb25maWcsXG4gICAgICAgICAgICB0bHNDb25maWc6IHRsc0NvbmZpZyxcbiAgICAgICAgICAgIHdlbGxLbm93bjogd2VsbEtub3duXG4gICAgICAgIH07XG4gICAgICAgIGlmICh6b25lTmFtZSkgZGF0YS56b25lTmFtZSA9IHpvbmVOYW1lO1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgaWYgKGZhbGxiYWNrQ2VydGlmaWNhdGUpIGRhdGEuZmFsbGJhY2tDZXJ0aWZpY2F0ZSA9IGZhbGxiYWNrQ2VydGlmaWNhdGU7XG5cbiAgICAgICAgcHV0KCcvYXBpL3YxL2RvbWFpbnMvJyArIGRvbWFpbiwgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgdGhhdC5zZXREbnNSZWNvcmRzKHsgZG9tYWluOiBkb21haW4sIHR5cGU6ICdtYWlsJyB9LCBjYWxsYmFjayk7IC8vIHRoaXMgaXMgZG9uZSBzbyB0aGF0IGFuIG91dC1vZi1zeW5jIGRraW0ga2V5IGNhbiBiZSBzeW5jZWRcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVuZXdDZXJ0cyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3JlbmV3X2NlcnRzJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGFza0lkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVtb3ZlRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGRlbCgnL2FwaS92MS9kb21haW5zLycgKyBkb21haW4sIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnByZXBhcmVEYXNoYm9hcmREb21haW4gPSBmdW5jdGlvbiAoZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGRvbWFpbjogZG9tYWluXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9jbG91ZHJvbi9wcmVwYXJlX2Rhc2hib2FyZF9kb21haW4nLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRhc2tJZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldERhc2hib2FyZERvbWFpbiA9IGZ1bmN0aW9uIChkb21haW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZG9tYWluOiBkb21haW5cbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3NldF9kYXNoYm9hcmRfZG9tYWluJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBFbWFpbFxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbEV2ZW50TG9ncyA9IGZ1bmN0aW9uIChzZWFyY2gsIHR5cGVzLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICB0eXBlczogdHlwZXMsXG4gICAgICAgICAgICAgICAgcGVyX3BhZ2U6IHBlclBhZ2UsXG4gICAgICAgICAgICAgICAgc2VhcmNoOiBzZWFyY2hcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9ldmVudGxvZycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmV2ZW50bG9ncyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldE1haWxVc2FnZSA9IGZ1bmN0aW9uIChkb21haW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICBkb21haW46IGRvbWFpblxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsc2VydmVyL3VzYWdlJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS51c2FnZSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldE1haWxMb2NhdGlvbiA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge307XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWxzZXJ2ZXIvbG9jYXRpb24nLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTsgLy8geyBzdWJkb21haW4sIGRvbWFpbiB9XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxMb2NhdGlvbiA9IGZ1bmN0aW9uIChzdWJkb21haW4sIGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsc2VydmVyL2xvY2F0aW9uJywgeyBzdWJkb21haW46IHN1YmRvbWFpbiwgZG9tYWluOiBkb21haW4gfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgeyB0YXNrSWQ6IGRhdGEudGFza0lkIH0pO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYXhFbWFpbFNpemUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHt9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsc2VydmVyL21heF9lbWFpbF9zaXplJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5zaXplKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0TWF4RW1haWxTaXplID0gZnVuY3Rpb24gKHNpemUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbHNlcnZlci9tYXhfZW1haWxfc2l6ZScsIHsgc2l6ZTogc2l6ZSB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U29sckNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge307XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc29scl9jb25maWcnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0U29sckNvbmZpZyA9IGZ1bmN0aW9uIChlbmFibGVkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc29scl9jb25maWcnLCB7IGVuYWJsZWQ6IGVuYWJsZWQgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFNwYW1BY2wgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHt9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsc2VydmVyL3NwYW1fYWNsJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFNwYW1BY2wgPSBmdW5jdGlvbiAoYWNsLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc3BhbV9hY2wnLCB7IHdoaXRlbGlzdDogYWNsLndoaXRlbGlzdCwgYmxhY2tsaXN0OiBhY2wuYmxhY2tsaXN0IH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTcGFtQ3VzdG9tQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9zcGFtX2N1c3RvbV9jb25maWcnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmNvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFNwYW1DdXN0b21Db25maWcgPSBmdW5jdGlvbiAoY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc3BhbV9jdXN0b21fY29uZmlnJywgeyBjb25maWc6IGNvbmZpZyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbENvbmZpZ0ZvckRvbWFpbiA9IGZ1bmN0aW9uIChkb21haW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5lbmFibGVNYWlsRm9yRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgZW5hYmxlZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2VuYWJsZScsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RG5zUmVjb3JkcyA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3N5bmNfZG5zJywgb3B0aW9ucywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsU3RhdHVzRm9yRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvc3RhdHVzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxSZWxheSA9IGZ1bmN0aW9uIChkb21haW4sIGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9yZWxheScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRNYWlsQmFubmVyID0gZnVuY3Rpb24gKGRvbWFpbiwgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2Jhbm5lcicsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRDYXRjaGFsbEFkZHJlc3NlcyA9IGZ1bmN0aW9uIChkb21haW4sIGFkZHJlc3NlcywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2NhdGNoX2FsbCcsIHsgYWRkcmVzc2VzOiBhZGRyZXNzZXMgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxGcm9tVmFsaWRhdGlvbiA9IGZ1bmN0aW9uIChkb21haW4sIGVuYWJsZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsX2Zyb21fdmFsaWRhdGlvbicsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIE1haWxib3hlc1xuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbGJveENvdW50ID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvbWFpbGJveF9jb3VudCcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuY291bnQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5saXN0TWFpbGJveGVzID0gZnVuY3Rpb24gKGRvbWFpbiwgc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgc2VhcmNoOiBzZWFyY2gsXG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL21haWxib3hlcycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5tYWlsYm94ZXMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsYm94ID0gZnVuY3Rpb24gKGRvbWFpbiwgbmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvbWFpbGJveGVzLycgKyBuYW1lLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLm1haWxib3gpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5hZGRNYWlsYm94ID0gZnVuY3Rpb24gKGRvbWFpbiwgbmFtZSwgb3duZXJJZCwgb3duZXJUeXBlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgICAgICBvd25lcklkOiBvd25lcklkLFxuICAgICAgICAgICAgb3duZXJUeXBlOiBvd25lclR5cGUsXG4gICAgICAgICAgICBhY3RpdmU6IHRydWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvbWFpbGJveGVzJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnVwZGF0ZU1haWxib3ggPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBvd25lcklkLCBvd25lclR5cGUsIGFjdGl2ZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBvd25lcklkOiBvd25lcklkLFxuICAgICAgICAgICAgb3duZXJUeXBlOiBvd25lclR5cGUsXG4gICAgICAgICAgICBhY3RpdmU6IGFjdGl2ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMvJyArIG5hbWUsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVNYWlsYm94ID0gZnVuY3Rpb24gKGRvbWFpbiwgbmFtZSwgZGVsZXRlTWFpbHMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlTWFpbHM6IGRlbGV0ZU1haWxzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMvJyArIG5hbWUsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFsaWFzZXMgPSBmdW5jdGlvbiAobmFtZSwgZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogMSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogMTAwMFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL21haWxib3hlcy8nICsgbmFtZSArICcvYWxpYXNlcycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5hbGlhc2VzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0QWxpYXNlcyA9IGZ1bmN0aW9uIChuYW1lLCBkb21haW4sIGFsaWFzZXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYWxpYXNlczogYWxpYXNlc1xuICAgICAgICB9O1xuXG4gICAgICAgIHB1dCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL21haWxib3hlcy8nICsgbmFtZSArICcvYWxpYXNlcycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5saXN0TWFpbGluZ0xpc3RzID0gZnVuY3Rpb24gKGRvbWFpbiwgc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgc2VhcmNoOiBzZWFyY2gsXG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2xpc3RzJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxpc3RzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cy8nICsgbmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5saXN0KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYWRkTWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBtZW1iZXJzLCBtZW1iZXJzT25seSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgbWVtYmVyczogbWVtYmVycyxcbiAgICAgICAgICAgIG1lbWJlcnNPbmx5OiBtZW1iZXJzT25seSxcbiAgICAgICAgICAgIGFjdGl2ZTogdHJ1ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDEpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVNYWlsaW5nTGlzdCA9IGZ1bmN0aW9uIChkb21haW4sIG5hbWUsIG1lbWJlcnMsIG1lbWJlcnNPbmx5LCBhY3RpdmUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbWVtYmVyczogbWVtYmVycyxcbiAgICAgICAgICAgIG1lbWJlcnNPbmx5OiBtZW1iZXJzT25seSxcbiAgICAgICAgICAgIGFjdGl2ZTogYWN0aXZlXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2xpc3RzLycgKyBuYW1lLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVtb3ZlTWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBkZWwoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cy8nICsgbmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBWb2x1bWVzXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRWb2x1bWVzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS92b2x1bWVzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS52b2x1bWVzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Vm9sdW1lID0gZnVuY3Rpb24gKHZvbHVtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3ZvbHVtZXMvJyArIHZvbHVtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFZvbHVtZVN0YXR1cyA9IGZ1bmN0aW9uICh2b2x1bWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS92b2x1bWVzLycgKyB2b2x1bWUgKyAnL3N0YXR1cycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5hZGRWb2x1bWUgPSBmdW5jdGlvbiAobmFtZSwgbW91bnRUeXBlLCBob3N0UGF0aCwgbW91bnRPcHRpb25zLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgICAgICBtb3VudFR5cGU6IG1vdW50VHlwZSxcbiAgICAgICAgICAgIG1vdW50T3B0aW9uczogbW91bnRPcHRpb25zXG4gICAgICAgIH07XG4gICAgICAgIGlmIChob3N0UGF0aCkgZGF0YS5ob3N0UGF0aCA9IGhvc3RQYXRoO1xuXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3ZvbHVtZXMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmlkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlVm9sdW1lID0gZnVuY3Rpb24gKHZvbHVtZUlkLCBtb3VudFR5cGUsIG1vdW50T3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBtb3VudFR5cGU6IG1vdW50VHlwZSxcbiAgICAgICAgICAgIG1vdW50T3B0aW9uczogbW91bnRPcHRpb25zXG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdm9sdW1lcy8nICsgdm9sdW1lSWQsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlbW92ZVZvbHVtZSA9IGZ1bmN0aW9uICh2b2x1bWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvdm9sdW1lcy8nICsgdm9sdW1lLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBzdG9yZVVzZXJUb2tlbiA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHN0b3JlL3VzZXJfdG9rZW4nLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5hY2Nlc3NUb2tlbik7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBUaGlzIHdpbGwgY2hhbmdlIHRoZSBsb2NhdGlvblxuICAgIENsaWVudC5wcm90b3R5cGUub3BlblN1YnNjcmlwdGlvblNldHVwID0gZnVuY3Rpb24gKHN1YnNjcmlwdGlvbikge1xuICAgICAgICAvLyB3ZSBvbmx5IGFsbG93IHRoZSBvd25lciB0byBkbyBzb1xuICAgICAgICBpZiAoIXRoaXMuX3VzZXJJbmZvLmlzQXRMZWFzdE93bmVyKSByZXR1cm47XG5cbiAgICAgICAgLy8gYmFzaWNhbGx5IHRoZSB1c2VyIGhhcyBub3Qgc2V0dXAgYXBwc3RvcmUgYWNjb3VudCB5ZXRcbiAgICAgICAgaWYgKCFzdWJzY3JpcHRpb24ucGxhbikgcmV0dXJuIHdpbmRvdy5sb2NhdGlvbi5ocmVmID0gJy8jL2FwcHN0b3JlJztcblxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgdmFyIGVtYWlsID0gc3Vic2NyaXB0aW9uLmVtYWlsRW5jb2RlZDtcbiAgICAgICAgdmFyIGNsb3Vkcm9uSWQgPSBzdWJzY3JpcHRpb24uY2xvdWRyb25JZDtcblxuICAgICAgICBpZiAoIXRoaXMuX3VzZXJJbmZvLmlzQXRMZWFzdE93bmVyKSByZXR1cm4gd2luZG93LmxvY2F0aW9uLmhyZWYgPSB0aGF0LmdldENvbmZpZygpLndlYlNlcnZlck9yaWdpbiArICcvY29uc29sZS5odG1sIy91c2VycHJvZmlsZT92aWV3PXN1YnNjcmlwdGlvbnMmZW1haWw9JyArIGVtYWlsICsgJyZjbG91ZHJvbklkPScgKyBjbG91ZHJvbklkO1xuXG4gICAgICAgIHRoaXMuZ2V0QXBwc3RvcmVVc2VyVG9rZW4oZnVuY3Rpb24gKGVycm9yLCB0b2tlbikge1xuICAgICAgICAgICAgaWYgKGVycm9yKSBjb25zb2xlLmVycm9yKCdVbmFibGUgdG8gZ2V0IGFwcHN0b3JlIHVzZXIgdG9rZW4uJywgZXJyb3IpO1xuXG4gICAgICAgICAgICB2YXIgdXJsID0gdGhhdC5nZXRDb25maWcoKS53ZWJTZXJ2ZXJPcmlnaW4gKyAnL2NvbnNvbGUuaHRtbCMvdXNlcnByb2ZpbGU/dmlldz1zdWJzY3JpcHRpb25zJmVtYWlsPScgKyBlbWFpbCArICcmdG9rZW49JyArIHRva2VuO1xuXG4gICAgICAgICAgICAvLyBPbmx5IG9wZW4gdGhlIHN1YnNjcmlwdGlvbiBzZXR1cCBkaWFsb2cgd2hlbiBubyBzdWJzY3JpcHRpb24gZXhpc3RzXG4gICAgICAgICAgICBpZiAoIXN1YnNjcmlwdGlvbi5wbGFuIHx8IHN1YnNjcmlwdGlvbi5wbGFuLmlkID09PSAnZnJlZScpIHVybCArPSAnJmNsb3Vkcm9uSWQ9JyArIGNsb3Vkcm9uSWRcblxuICAgICAgICAgICAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSB1cmw7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcHN0b3JlQXBwQnlJZEFuZFZlcnNpb24gPSBmdW5jdGlvbiAoYXBwSWQsIHZlcnNpb24sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB1cmwgPSAnL2FwaS92MS9hcHBzdG9yZS9hcHBzLycgKyBhcHBJZDtcbiAgICAgICAgaWYgKHZlcnNpb24gJiYgdmVyc2lvbiAhPT0gJ2xhdGVzdCcpIHVybCArPSAnL3ZlcnNpb25zLycgKyB2ZXJzaW9uO1xuXG4gICAgICAgIGdldCh1cmwsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBzdG9yZUFwcHMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBzdG9yZS9hcHBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgYW5ndWxhci5jb3B5KGRhdGEuYXBwcywgdGhhdC5fYXBwc3RvcmVBcHBDYWNoZSk7XG5cbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCB0aGF0Ll9hcHBzdG9yZUFwcENhY2hlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwc3RvcmVBcHBzRmFzdCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBpZiAodGhpcy5fYXBwc3RvcmVBcHBDYWNoZS5sZW5ndGggIT09IDApIHJldHVybiBjYWxsYmFjayhudWxsLCB0aGlzLl9hcHBzdG9yZUFwcENhY2hlKTtcblxuICAgICAgICB0aGlzLmdldEFwcHN0b3JlQXBwcyhjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U3Vic2NyaXB0aW9uID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmICghdGhpcy5fdXNlckluZm8uaXNBdExlYXN0QWRtaW4pIHJldHVybiBjYWxsYmFjayhuZXcgRXJyb3IoJ05vdCBhbGxvd2VkJykpO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBzdG9yZS9zdWJzY3JpcHRpb24nLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAvLyBqdXN0IHNvbWUgaGVscGVyIHByb3BlcnR5LCBzaW5jZSBhbmd1bGFyIGJpbmRpbmdzIGNhbm5vdCBkb3QgaGlzIGVhc2lseVxuICAgICAgICAgICAgZGF0YS5lbWFpbEVuY29kZWQgPSBlbmNvZGVVUklDb21wb25lbnQoZGF0YS5lbWFpbCk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpOyAvLyB7IGVtYWlsLCBwbGFuOiB7IGlkLCBuYW1lIH0sIGNhbmNlbF9hdCwgc3RhdHVzIH1cbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVnaXN0ZXJDbG91ZHJvbiA9IGZ1bmN0aW9uIChlbWFpbCwgcGFzc3dvcmQsIHRvdHBUb2tlbiwgc2lnbnVwLCBwdXJwb3NlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGVtYWlsOiBlbWFpbCxcbiAgICAgICAgICAgIHBhc3N3b3JkOiBwYXNzd29yZCxcbiAgICAgICAgICAgIHNpZ251cDogc2lnbnVwLFxuICAgICAgICAgICAgcHVycG9zZTogcHVycG9zZVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh0b3RwVG9rZW4pIGRhdGEudG90cFRva2VuID0gdG90cFRva2VuO1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwc3RvcmUvcmVnaXN0ZXJfY2xvdWRyb24nLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIEZpbGVNYW5hZ2VyIEFQSVxuICAgIC8vIG1vZGUgY2FuIGJlICdkb3dubG9hZCcsICdvcGVuJywgJ2xpbmsnIG9yICdkYXRhJ1xuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNHZXQgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIG1vZGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gKHR5cGUgPT09ICdhcHAnID8gJ2FwcHMvJyA6ICd2b2x1bWVzLycpICsgaWQ7XG5cbiAgICAgICAgaWYgKG1vZGUgPT09ICdkb3dubG9hZCcpIHtcbiAgICAgICAgICAgIHdpbmRvdy5vcGVuKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGggKyAnP2Rvd25sb2FkPXRydWUmYWNjZXNzX3Rva2VuPScgKyB0b2tlbik7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSBlbHNlIGlmIChtb2RlID09PSAnb3BlbicpIHtcbiAgICAgICAgICAgIHdpbmRvdy5vcGVuKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGggKyAnP2Rvd25sb2FkPWZhbHNlJmFjY2Vzc190b2tlbj0nICsgdG9rZW4pO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0gZWxzZSBpZiAobW9kZSA9PT0gJ2xpbmsnKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBjbGllbnQuYXBpT3JpZ2luICsgJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoICsgJz9kb3dubG9hZD1mYWxzZSZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIHJlc3BvbnNlSGFuZGxlcihkYXRhLCBoZWFkZXJzLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaGVhZGVycygpWydjb250ZW50LXR5cGUnXSAmJiBoZWFkZXJzKClbJ2NvbnRlbnQtdHlwZSddLmluZGV4T2YoJ2FwcGxpY2F0aW9uL2pzb24nKSAhPT0gLTEpIHJldHVybiBKU09OLnBhcnNlKGRhdGEpO1xuICAgICAgICAgICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBnZXQoJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLCB7IHRyYW5zZm9ybVJlc3BvbnNlOiByZXNwb25zZUhhbmRsZXIgfSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmZpbGVzUmVtb3ZlID0gZnVuY3Rpb24gKGlkLCB0eXBlLCBwYXRoLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgb2JqcGF0aCA9ICh0eXBlID09PSAnYXBwJyA/ICdhcHBzLycgOiAndm9sdW1lcy8nKSArIGlkO1xuXG4gICAgICAgIGRlbCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0V4dHJhY3QgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gKHR5cGUgPT09ICdhcHAnID8gJ2FwcHMvJyA6ICd2b2x1bWVzLycpICsgaWQ7XG5cbiAgICAgICAgcHV0KCcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCwgeyBhY3Rpb246ICdleHRyYWN0JyB9LCB7fSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmZpbGVzQ2hvd24gPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIHVpZCwgcmVjdXJzaXZlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgb2JqcGF0aCA9ICh0eXBlID09PSAnYXBwJyA/ICdhcHBzLycgOiAndm9sdW1lcy8nKSArIGlkO1xuXG4gICAgICAgIHB1dCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIHsgYWN0aW9uOiAnY2hvd24nLCB1aWQ6IHVpZCwgcmVjdXJzaXZlOiByZWN1cnNpdmUgfSwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc1JlbmFtZSA9IGZ1bmN0aW9uIChpZCwgdHlwZSwgcGF0aCwgbmV3UGF0aCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSAodHlwZSA9PT0gJ2FwcCcgPyAnYXBwcy8nIDogJ3ZvbHVtZXMvJykgKyBpZDtcblxuICAgICAgICBwdXQoJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLCB7IGFjdGlvbjogJ3JlbmFtZScsIG5ld0ZpbGVQYXRoOiBkZWNvZGVVUklDb21wb25lbnQobmV3UGF0aCkgfSwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0NvcHkgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIG5ld1BhdGgsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICB2YXIgb2JqcGF0aCA9ICh0eXBlID09PSAnYXBwJyA/ICdhcHBzLycgOiAndm9sdW1lcy8nKSArIGlkO1xuXG4gICAgICAgIHB1dCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIHsgYWN0aW9uOiAnY29weScsIG5ld0ZpbGVQYXRoOiBkZWNvZGVVUklDb21wb25lbnQobmV3UGF0aCkgfSwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3Iuc3RhdHVzQ29kZSA9PT0gNDA5KSByZXR1cm4gdGhhdC5maWxlc0NvcHkoaWQsIHR5cGUsIHBhdGgsIG5ld1BhdGggKyAnLWNvcHknLCBjYWxsYmFjayk7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0NyZWF0ZURpcmVjdG9yeSA9IGZ1bmN0aW9uIChpZCwgdHlwZSwgcGF0aCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSAodHlwZSA9PT0gJ2FwcCcgPyAnYXBwcy8nIDogJ3ZvbHVtZXMvJykgKyBpZDtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCwgeyBkaXJlY3Rvcnk6IGRlY29kZVVSSUNvbXBvbmVudChwYXRoKSB9LCB7fSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmZpbGVzQ3JlYXRlRmlsZSA9IGZ1bmN0aW9uIChpZCwgdHlwZSwgcGF0aCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSAodHlwZSA9PT0gJ2FwcCcgPyAnYXBwcy8nIDogJ3ZvbHVtZXMvJykgKyBpZDtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCwge30sIHt9LCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNVcGxvYWQgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIGZpbGUsIG92ZXJ3cml0ZSwgcHJvZ3Jlc3NIYW5kbGVyLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgb2JqcGF0aCA9ICh0eXBlID09PSAnYXBwJyA/ICdhcHBzLycgOiAndm9sdW1lcy8nKSArIGlkO1xuXG4gICAgICAgIHZhciBmZCA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgICBmZC5hcHBlbmQoJ2ZpbGUnLCBmaWxlKTtcblxuICAgICAgICBpZiAob3ZlcndyaXRlKSBmZC5hcHBlbmQoJ292ZXJ3cml0ZScsICd0cnVlJyk7XG5cbiAgICAgICAgZnVuY3Rpb24gZG9uZShlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgJGh0dHAoe1xuICAgICAgICAgICAgdXJsOiBjbGllbnQuYXBpT3JpZ2luICsgJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBmZCxcbiAgICAgICAgICAgIHRyYW5zZm9ybVJlcXVlc3Q6IGFuZ3VsYXIuaWRlbnRpdHksXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICBBdXRob3JpemF0aW9uOiAnQmVhcmVyICcgKyB0b2tlblxuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgdXBsb2FkRXZlbnRIYW5kbGVyczoge1xuICAgICAgICAgICAgICAgIHByb2dyZXNzOiBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc0hhbmRsZXIoZS5sb2FkZWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuc3VjY2VzcyhkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoZG9uZSkpLmVycm9yKGRlZmF1bHRFcnJvckhhbmRsZXIoZG9uZSkpO1xuICAgIH07XG5cbiAgICBjbGllbnQgPSBuZXcgQ2xpZW50KCk7XG4gICAgcmV0dXJuIGNsaWVudDtcbn1dKTtcbiJdfQ==
