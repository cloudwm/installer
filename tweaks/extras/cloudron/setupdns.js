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
        { name: 'Hetzner', value: 'hetzner' },
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
        hetznerToken: '',
        vultrToken: '',
        nameComUsername: '',
        nameComToken: '',
        namecheapUsername: '',
        namecheapApiKey: '',
        netcupCustomerNumber: '',
        netcupApiKey: '',
        netcupApiPassword: '',
        provider: 'route53',
        zoneName: '',
        tlsConfig: {
            provider: 'letsencrypt-prod-wildcard'
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
        } else if (provider === 'hetzner') {
            config.token = $scope.dnsCredentials.hetznerToken;
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
            domainConfig: {
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
    MAIL_MANAGER: 'mailmanager',
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
        suffix: '.json?' + '32d97f9ffba9ba7a989d8ef52be913efb0d20946'
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

            (function onlineCheck() {
                $http.get(client.apiOrigin + '/api/v1/cloudron/status', {}).success(function (data, status) {
                    client.offline = false;
                    client._reconnectListener.forEach(function (handler) { handler(); });
                }).error(function (data, status) {
                    client.offline = true;
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
            avatarUrl: null,
            hasBackgroundImage: false
        };
        this._config = {
            consoleServerOrigin: null,
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
        if (this._config) callback(this._config);
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
        this._userInfo.hasBackgroundImage = userInfo.hasBackgroundImage;
        this._userInfo.isAtLeastOwner = [ ROLES.OWNER ].indexOf(userInfo.role) !== -1;
        this._userInfo.isAtLeastAdmin = [ ROLES.OWNER, ROLES.ADMIN ].indexOf(userInfo.role) !== -1;
        this._userInfo.isAtLeastMailManager = [ ROLES.OWNER, ROLES.ADMIN, ROLES.MAIL_MANAGER ].indexOf(userInfo.role) !== -1;
        this._userInfo.isAtLeastUserManager = [ ROLES.OWNER, ROLES.ADMIN, ROLES.MAIL_MANAGER, ROLES.USER_MANAGER ].indexOf(userInfo.role) !== -1;
    };

    Client.prototype.setConfig = function (config) {
        var that = this;

        angular.copy(config, this._config);


        // => This is just for easier testing
        // this._config.features.externalLdap = false;

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
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.changeCloudronName = function (name, callback) {
        var data = {
            name: name
        };

        post('/api/v1/branding/cloudron_name', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.installApp = function (id, manifest, title, config, callback) {
        var that = this;
        var data = {
            appStoreId: id + '@' + manifest.version,
            subdomain: config.subdomain,
            domain: config.domain,
            secondaryDomains: config.secondaryDomains,
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
            subdomain: config.subdomain,
            domain: config.domain,
            secondaryDomains: config.secondaryDomains,
            portBindings: config.portBindings,
            backupId: config.backupId,
            overwriteDns: !!config.overwriteDns
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

    Client.prototype.editAppBackup = function (id, backupId, label, preserveSecs, callback) {
        post('/api/v1/apps/' + id + '/backups/' + backupId, { label: label, preserveSecs: preserveSecs }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
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

    Client.prototype.createExec = function (id, options, callback) {
        post('/api/v1/apps/' + id + '/exec', options, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.id);
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

    Client.prototype.remountBackupStorage = function (callback) {
        post('/api/v1/backups/remount', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null);
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

    Client.prototype.setProfileConfig = function (config, callback) {
        post('/api/v1/settings/profile_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getProfileConfig = function (callback) {
        get('/api/v1/settings/profile_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.setUserDirectoryConfig = function (config, callback) {
        post('/api/v1/settings/user_directory_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getUserDirectoryConfig = function (callback) {
        get('/api/v1/settings/user_directory_config', null, function (error, data, status) {
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

    Client.prototype.getSysinfoConfig = function (callback) {
        get('/api/v1/settings/sysinfo_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getServerIpv4 = function (callback) {
        get('/api/v1/cloudron/server_ipv4', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getServerIpv6 = function (callback) {
        get('/api/v1/cloudron/server_ipv6', null, function (error, data, status) {
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

    Client.prototype.setIPv6Config = function (config, callback) {
        post('/api/v1/settings/ipv6_config', config, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.getIPv6Config = function (callback) {
        get('/api/v1/settings/ipv6_config', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
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

    Client.prototype.checkForAppUpdates = function (appId, callback) {
        post('/api/v1/apps/' + appId + '/check_for_updates', {}, null, function (error, data, status) {
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

    Client.prototype.editBackup = function (backupId, label, preserveSecs, callback) {
        post('/api/v1/backups/' + backupId, { label: label, preserveSecs: preserveSecs }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
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

    Client.prototype.restore = function (backupConfig, remotePath, version, sysinfoConfig, skipDnsSetup, setupToken, callback) {
        var data = {
            backupConfig: backupConfig,
            remotePath: remotePath,
            version: version,
            sysinfoConfig: sysinfoConfig,
            skipDnsSetup: skipDnsSetup,
            setupToken: setupToken
        };

        post('/api/v1/cloudron/restore', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status));

            callback(null);
        });
    };

    Client.prototype.importBackup = function (appId, remotePath, backupFormat, backupConfig, callback) {
        var data = {
            remotePath: remotePath,
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

    Client.prototype.getAllUsers = function (callback) {
        var page = 1;
        var perPage = 5000;
        var users = [];

        function fetchMore() {
            var config = {
                params: {
                    page: page,
                    per_page: perPage
                }
            };

            get('/api/v1/users', config, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 200) return callback(new ClientError(status, data));

                users = users.concat(data.users);

                if (data.users.length < perPage) return callback(null, users);

                page++;

                fetchMore();
            });
        }

        fetchMore();
    };

    Client.prototype.getUsers = function (search, active, page, perPage, callback) {
        var config = {
            params: {
                page: page,
                per_page: perPage
            }
        };

        if (search) config.params.search = search;
        if (active !== null) config.params.active = active ? 'true' : 'false';

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

    Client.prototype.getAppTask = function (appId, callback) {
        get('/api/v1/apps/' + appId + '/task', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getAppLimits = function (appId, callback) {
        get('/api/v1/apps/' + appId + '/limits', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.limits);
        });
    };

    Client.prototype.getAppWithTask = function (appId, callback) {
        var that = this;

        this.getApp(appId, function (error, app) {
            if (error) return callback(error);

            if (!app.taskId) return callback(null, app);

            that.getAppTask(appId, function (error, task) {
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

            get(options.appId ? '/api/v1/apps/' + options.appId + '/graphs' : '/api/v1/cloudron/graphs', config, function (error, data, status) {
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

    Client.prototype.addUser = function (user, callback) {
        var data = {
            email: user.email,
            fallbackEmail: user.fallbackEmail,
            displayName: user.displayName,
            role: user.role
        };

        if (user.username) data.username = user.username;
        if (user.password) data.password = user.password;

        post('/api/v1/users', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 201) return callback(new ClientError(status, data));

            callback(null, data.id);
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
        if (user.username) data.username = user.username;

        post('/api/v1/users/' + user.id, data, null, function (error, data, status) {
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

    Client.prototype.changeAvatar = function (avatarFileOrType, callback) {
        // Blob type if object
        if (typeof avatarFileOrType === 'object') {
            var fd = new FormData();
            fd.append('avatar', avatarFileOrType);

            var config = {
                headers: { 'Content-Type': undefined },
                transformRequest: angular.identity
            };

            post('/api/v1/profile/avatar', fd, config, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 202) return callback(new ClientError(status, data));
                callback(null);
            });
        } else {
            post('/api/v1/profile/avatar', { avatar: avatarFileOrType === 'gravatar' ? 'gravatar' : '' }, null, function (error, data, status) {
                if (error) return callback(error);
                if (status !== 202) return callback(new ClientError(status, data));
                callback(null);
            });
        }
    };

    Client.prototype.getBackgroundImageUrl = function () {
        return client.apiOrigin + '/api/v1/profile/backgroundImage?access_token=' + token + '&bustcache=' + Date.now();
    };

    Client.prototype.setBackgroundImage = function (backgroundImage, callback) {
        // Blob type if object
        var fd = new FormData();
        if (backgroundImage) fd.append('backgroundImage', backgroundImage);

        var config = {
            headers: { 'Content-Type': undefined },
            transformRequest: angular.identity
        };

        post('/api/v1/profile/backgroundImage', fd, config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));
            callback(null);
        });
    };

    Client.prototype.makeUserLocal = function (userId, callback) {
        post('/api/v1/users/' + userId + '/make_local', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

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

    Client.prototype.getPasswordResetLink = function (userId, callback) {
        get('/api/v1/users/' + userId + '/password_reset_link', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.sendPasswordResetEmail = function (userId, email, callback) {
        post('/api/v1/users/' + userId + '/send_password_reset_email', { email }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.sendSelfPasswordReset = function (identifier, callback) {
        post('/api/v1/cloudron/password_reset_request', { identifier }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.getInviteLink = function (userId, callback) {
        get('/api/v1/users/' + userId + '/invite_link', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.sendInviteEmail = function (userId, email, callback) {
        post('/api/v1/users/' + userId + '/send_invite_email', { email }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

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

    Client.prototype.setGhost = function (userId, password, expiresAt, callback) {
        var data = { password };

        if (expiresAt) data.expiresAt = expiresAt;

        post('/api/v1/users/' + userId + '/ghost', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

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

        if (app.manifest.upstreamVersion) {
            app.upstreamVersion = app.manifest.upstreamVersion;
        } else if (app.manifest.description) { // can be empty for dev apps
            var tmp = app.manifest.description.match(/\<upstream\>(.*)\<\/upstream\>/i);
            app.upstreamVersion = (tmp && tmp[1]) ? tmp[1] : '';
        } else {
            app.upstreamVersion = '';
        }

        if (!app.manifest.title) app.manifest.title = 'Untitled';

        if (app.manifest.postInstallMessage) {
            var text= app.manifest.postInstallMessage;
            // we chose - because underscore has special meaning in markdown
            text = text.replace(/\$CLOUDRON-APP-LOCATION/g, app.subdomain);
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

                if (app.accessLevel !== 'operator' && app.accessLevel !== 'admin') { // only fetch if we have permissions
                    app.progress = 0;
                    app.message = '';
                    app.taskMinutesActive = 0;

                    that._updateAppCache(app);

                    return iteratorCallback();
                }

                var getTaskFunc = app.taskId ? that.getAppTask.bind(null, app.id) : function (next) { return next(); };
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

    Client.prototype.getAppEventLog = function (appId, page, perPage, callback) {
        var config = {
            params: {
                page: page,
                per_page: perPage
            }
        };

        get('/api/v1/apps/' + appId + '/eventlog', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data.eventlogs);
        });
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

    Client.prototype.addDomain = function (domain, zoneName, provider, config, fallbackCertificate, tlsConfig, callback) {
        var data = {
            domain: domain,
            provider: provider,
            config: config,
            tlsConfig: tlsConfig,
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

    Client.prototype.updateDomainConfig = function (domain, zoneName, provider, config, fallbackCertificate, tlsConfig, callback) {
        var data = {
            provider: provider,
            config: config,
            tlsConfig: tlsConfig
        };
        if (zoneName) data.zoneName = zoneName;
        var that = this;

        if (fallbackCertificate) data.fallbackCertificate = fallbackCertificate;

        post('/api/v1/domains/' + domain + '/config', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            that.setDnsRecords({ domain: domain, type: 'mail' }, callback); // this is done so that an out-of-sync dkim key can be synced
        });
    };

    Client.prototype.updateDomainWellKnown = function (domain, wellKnown, callback) {
        var data = {
            wellKnown: wellKnown
        };
        var that = this;

        post('/api/v1/domains/' + domain + '/wellknown', data, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 204) return callback(new ClientError(status, data));

            callback(null);
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

    Client.prototype.getMailboxSharing = function (callback) {
        get('/api/v1/mailserver/mailbox_sharing', {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data.enabled);
        });
    };

    Client.prototype.setMailboxSharing = function (enable, callback) {
        post('/api/v1/mailserver/mailbox_sharing', { enable: enable }, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null);
        });
    };

    Client.prototype.getDnsblConfig = function (callback) {
        var config = {};

        get('/api/v1/mailserver/dnsbl_config', config, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));
            callback(null, data);
        });
    };

    Client.prototype.setDnsblConfig = function (zones, callback) {
        post('/api/v1/mailserver/dnsbl_config', { zones: zones }, null, function (error, data, status) {
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
    Client.prototype.getAllMailboxes = function (callback) {
        var that = this;

        this.getDomains(function (error, domains) {
            if (error) return callback(error);

            var mailboxes = [];
            async.eachLimit(domains, 5, function (domain, callback) {
                that.listMailboxes(domain.domain, '', 1, 1000, function (error, result) {
                    if (error) return callback(error);

                    mailboxes = mailboxes.concat(result);

                    callback();
                });
            }, function (error) {
                if (error) return callback(error);

                callback(null, mailboxes);
            });
        });
    };

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

    Client.prototype.updateMailbox = function (domain, name, data, callback) {
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

    Client.prototype.remountVolume = function (volumeId, callback) {
        var that = this;

        post('/api/v1/volumes/' + volumeId + '/remount', {}, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 202) return callback(new ClientError(status, data));

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

    // This will change the location
    Client.prototype.openSubscriptionSetup = function (subscription) {
        // we only allow the owner to do so
        if (!this._userInfo.isAtLeastOwner) return;

        // basically the user has not setup appstore account yet
        if (!subscription.plan) return window.location.href = '/#/appstore';

        if (subscription.plan.id === 'free') window.open(this.getConfig().consoleServerOrigin + '/#/subscription_setup/' + subscription.cloudronId + '?email=' + subscription.emailEncoded, '_blank');
        else window.open(this.getConfig().consoleServerOrigin + '/#/cloudron/' + subscription.cloudronId + '?email=' + subscription.emailEncoded, '_blank');
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

    Client.prototype._onAppstoreApps = function (callback) {
        if (!this._fetchingAppstoreApps) {console.log('not fetching'); callback(); }
        else this._fetchingAppstoreAppsListener.push(callback);
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
        get('/api/v1/appstore/subscription', null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            // just some helper property, since angular bindings cannot dot his easily
            data.emailEncoded = encodeURIComponent(data.email);

            callback(null, data); // { email, plan: { id, name }, cancel_at, status }
        });
    };

    Client.prototype.registerCloudron = function (email, password, totpToken, signup, callback) {
        var data = {
            email: email,
            password: password,
            signup: signup,
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
    function getObjpath(id, type) {
        if (type === 'mail') return 'mailserver';
        if (type === 'app') return 'apps/' + id;
        if (type === 'volume') return 'volumes/' + id;
    }

    Client.prototype.filesGetLink = function (id, type, path) {
        var objpath = getObjpath(id, type);
        return client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=false&access_token=' + token;
    };

    Client.prototype.filesGet = function (id, type, path, mode, callback) {
        var objpath = getObjpath(id, type);

        if (mode === 'download') {
            window.open(client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=true&access_token=' + token);
            callback(null);
        } else if (mode === 'open') {
            window.open(client.apiOrigin + '/api/v1/' + objpath + '/files/' + path + '?download=false&access_token=' + token);
            callback(null);
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
        var objpath = getObjpath(id, type);

        del('/api/v1/' + objpath + '/files/' + path, null, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesExtract = function (id, type, path, callback) {
        var objpath = getObjpath(id, type);

        put('/api/v1/' + objpath + '/files/' + path, { action: 'extract' }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesChown = function (id, type, path, uid, recursive, callback) {
        var objpath = getObjpath(id, type);

        put('/api/v1/' + objpath + '/files/' + path, { action: 'chown', uid: uid, recursive: recursive }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesRename = function (id, type, path, newPath, callback) {
        var objpath = getObjpath(id, type);

        put('/api/v1/' + objpath + '/files/' + path, { action: 'rename', newFilePath: decodeURIComponent(newPath) }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCopy = function (id, type, path, newPath, callback) {
        var that = this;

        var objpath = getObjpath(id, type);

        put('/api/v1/' + objpath + '/files/' + path, { action: 'copy', newFilePath: decodeURIComponent(newPath) }, {}, function (error, data, status) {
            if (error && error.statusCode === 409) return that.filesCopy(id, type, path, newPath + '-copy', callback);
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCreateDirectory = function (id, type, path, callback) {
        var objpath = getObjpath(id, type);

        post('/api/v1/' + objpath + '/files/' + path, { directory: decodeURIComponent(path) }, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesCreateFile = function (id, type, path, callback) {
        var objpath = getObjpath(id, type);

        post('/api/v1/' + objpath + '/files/' + path, {}, {}, function (error, data, status) {
            if (error) return callback(error);
            if (status !== 200) return callback(new ClientError(status, data));

            callback(null, data);
        });
    };

    Client.prototype.filesUpload = function (id, type, path, file, overwrite, progressHandler, callback) {
        var objpath = getObjpath(id, type);

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

    // ----------------------------------------------
    // Eventlog helpers
    // ----------------------------------------------
    Client.prototype.eventLogDetails = function (eventLog, appIdContext) {
        var ACTION_ACTIVATE = 'cloudron.activate';
        var ACTION_PROVISION = 'cloudron.provision';
        var ACTION_RESTORE = 'cloudron.restore';

        var ACTION_APP_CLONE = 'app.clone';
        var ACTION_APP_REPAIR = 'app.repair';
        var ACTION_APP_CONFIGURE = 'app.configure';
        var ACTION_APP_INSTALL = 'app.install';
        var ACTION_APP_RESTORE = 'app.restore';
        var ACTION_APP_IMPORT = 'app.import';
        var ACTION_APP_UNINSTALL = 'app.uninstall';
        var ACTION_APP_UPDATE = 'app.update';
        var ACTION_APP_UPDATE_FINISH = 'app.update.finish';
        var ACTION_APP_BACKUP = 'app.backup';
        var ACTION_APP_BACKUP_FINISH = 'app.backup.finish';
        var ACTION_APP_LOGIN = 'app.login';
        var ACTION_APP_OOM = 'app.oom';
        var ACTION_APP_UP = 'app.up';
        var ACTION_APP_DOWN = 'app.down';
        var ACTION_APP_START = 'app.start';
        var ACTION_APP_STOP = 'app.stop';
        var ACTION_APP_RESTART = 'app.restart';

        var ACTION_BACKUP_FINISH = 'backup.finish';
        var ACTION_BACKUP_START = 'backup.start';
        var ACTION_BACKUP_CLEANUP_START = 'backup.cleanup.start';
        var ACTION_BACKUP_CLEANUP_FINISH = 'backup.cleanup.finish';
        var ACTION_CERTIFICATE_NEW = 'certificate.new';
        var ACTION_CERTIFICATE_RENEWAL = 'certificate.renew';
        var ACTION_CERTIFICATE_CLEANUP = 'certificate.cleanup';

        var ACTION_DASHBOARD_DOMAIN_UPDATE = 'dashboard.domain.update';

        var ACTION_DOMAIN_ADD = 'domain.add';
        var ACTION_DOMAIN_UPDATE = 'domain.update';
        var ACTION_DOMAIN_REMOVE = 'domain.remove';

        var ACTION_INSTALL_FINISH = 'cloudron.install.finish';

        var ACTION_START = 'cloudron.start';
        var ACTION_SERVICE_CONFIGURE = 'service.configure';
        var ACTION_SERVICE_REBUILD = 'service.rebuild';
        var ACTION_SERVICE_RESTART = 'service.restart';
        var ACTION_UPDATE = 'cloudron.update';
        var ACTION_UPDATE_FINISH = 'cloudron.update.finish';
        var ACTION_USER_ADD = 'user.add';
        var ACTION_USER_LOGIN = 'user.login';
        var ACTION_USER_LOGOUT = 'user.logout';
        var ACTION_USER_REMOVE = 'user.remove';
        var ACTION_USER_UPDATE = 'user.update';
        var ACTION_USER_TRANSFER = 'user.transfer';

        var ACTION_MAIL_LOCATION = 'mail.location';
        var ACTION_MAIL_ENABLED = 'mail.enabled';
        var ACTION_MAIL_DISABLED = 'mail.disabled';
        var ACTION_MAIL_MAILBOX_ADD = 'mail.box.add';
        var ACTION_MAIL_MAILBOX_UPDATE = 'mail.box.update';
        var ACTION_MAIL_MAILBOX_REMOVE = 'mail.box.remove';
        var ACTION_MAIL_LIST_ADD = 'mail.list.add';
        var ACTION_MAIL_LIST_UPDATE = 'mail.list.update';
        var ACTION_MAIL_LIST_REMOVE = 'mail.list.remove';

        var ACTION_SUPPORT_TICKET = 'support.ticket';
        var ACTION_SUPPORT_SSH = 'support.ssh';

        var ACTION_VOLUME_ADD = 'volume.add';
        var ACTION_VOLUME_UPDATE = 'volume.update';
        var ACTION_VOLUME_REMOVE = 'volume.remove';

        var ACTION_DYNDNS_UPDATE = 'dyndns.update';

        var ACTION_SYSTEM_CRASH = 'system.crash';

        var data = eventLog.data;
        var errorMessage = data.errorMessage;
        var details, app;

        function appName(pre, app, defaultValue) {
            if (appIdContext) return defaultValue || '';

            pre = pre ? (pre + ' ') : '';

            return pre + (app.label || app.fqdn || app.subdomain) + ' (' + app.manifest.title + ') ';
        }

        switch (eventLog.action) {
        case ACTION_ACTIVATE:
            return 'Cloudron was activated';

        case ACTION_PROVISION:
            return 'Cloudron was setup';

        case ACTION_RESTORE:
            return 'Cloudron was restored using backup at ' + data.remotePath;

        case ACTION_APP_CONFIGURE: {
            if (!data.app) return '';
            app = data.app;

            var q = function (x) {
                return '"' + x + '"';
            };

            if ('accessRestriction' in data) { // since it can be null
                return 'Access restriction ' + appName('of', app) + ' was changed';
            } else if ('operators' in data) {
                return 'Operators ' + appName('of', app) + ' was changed';
            } else if (data.label) {
                return 'Label ' + appName('of', app) + ' was set to ' + q(data.label);
            } else if (data.tags) {
                return 'Tags ' + appName('of', app) + ' was set to ' + q(data.tags.join(','));
            } else if (data.icon) {
                return 'Icon ' + appName('of', app) + ' was changed';
            } else if (data.memoryLimit) {
                return 'Memory limit ' + appName('of', app) + ' was set to ' + data.memoryLimit;
            } else if (data.cpuShares) {
                return 'CPU shares ' + appName('of', app) + ' was set to ' + Math.round((data.cpuShares * 100)/1024) + '%';
            } else if (data.env) {
                return 'Env vars ' + appName('of', app) + ' was changed';
            } else if ('debugMode' in data) { // since it can be null
                if (data.debugMode) {
                    return appName('', app, 'App') + ' was placed in repair mode';
                } else {
                    return appName('', app, 'App') + ' was taken out of repair mode';
                }
            } else if ('enableBackup' in data) {
                return 'Automatic backups ' + appName('of', app) + ' were ' + (data.enableBackup ? 'enabled' : 'disabled');
            } else if ('enableAutomaticUpdate' in data) {
                return 'Automatic updates ' + appName('of', app) + ' were ' + (data.enableAutomaticUpdate ? 'enabled' : 'disabled');
            } else if ('reverseProxyConfig' in data) {
                return 'Reverse proxy configuration ' + appName('of', app) + ' was updated';
            } else if ('cert' in data) {
                if (data.cert) {
                    return 'Custom certificate was set ' + appName('for', app);
                } else {
                    return 'Certificate ' + appName('of', app) + ' was reset';
                }
            } else if (data.subdomain) {
                if (data.fqdn !== data.app.fqdn) {
                    return 'Location ' + appName('of', app) + ' was changed to ' + data.fqdn;
                } else if (!angular.equals(data.redirectDomains, data.app.redirectDomains)) {
                    var altFqdns = data.redirectDomains.map(function (a) { return a.fqdn; });
                    return 'Alternate domains ' + appName('of', app) + ' was ' + (altFqdns.length ? 'set to ' + altFqdns.join(', ') : 'reset');
                } else if (!angular.equals(data.aliasDomains, data.app.aliasDomains)) {
                    var aliasDomains = data.aliasDomains.map(function (a) { return a.fqdn; });
                    return 'Alias domains ' + appName('of', app) + ' was ' + (aliasDomains.length ? 'set to ' + aliasDomains.join(', ') : 'reset');
                } else if (!angular.equals(data.portBindings, data.app.portBindings)) {
                    return 'Port bindings ' + appName('of', app) + ' was changed';
                }
            } else if ('dataDir' in data) {
                if (data.dataDir) {
                    return 'Data directory ' + appName('of', app) + ' was set ' + data.dataDir;
                } else {
                    return 'Data directory ' + appName('of', app) + ' was reset';
                }
            } else if ('icon' in data) {
                if (data.icon) {
                    return 'Icon ' + appName('of', app) + ' was set';
                } else {
                    return 'Icon ' + appName('of', app) + ' was reset';
                }
            } else if (('mailboxName' in data) && data.mailboxName !== data.app.mailboxName) {
                if (data.mailboxName) {
                    return 'Mailbox ' + appName('of', app) + ' was set to ' + q(data.mailboxName);
                } else {
                    return 'Mailbox ' + appName('of', app) + ' was reset';
                }
            }

            return appName('', app, 'App') + 'was re-configured';
        }

        case ACTION_APP_INSTALL:
            if (!data.app) return '';
            return data.app.manifest.title + ' (package v' + data.app.manifest.version + ') was installed ' + appName('at', data.app);

        case ACTION_APP_RESTORE:
            if (!data.app) return '';
            details = appName('', data.app, 'App') + ' was restored';
            // older versions  (<3.5) did not have these fields
            if (data.fromManifest) details += ' from version ' + data.fromManifest.version;
            if (data.toManifest) details += ' to version ' + data.toManifest.version;
            if (data.remotePath) details += ' using backup at ' + data.remotePath;
            return details;

        case ACTION_APP_IMPORT:
            if (!data.app) return '';
            details = appName('', data.app, 'App') + 'was imported';
            if (data.toManifest) details += ' to version ' + data.toManifest.version;
            if (data.remotePath) details += ' using backup at ' + data.remotePath;
            return details;

        case ACTION_APP_UNINSTALL:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' (package v' + data.app.manifest.version + ') was uninstalled';

        case ACTION_APP_UPDATE:
            if (!data.app) return '';
            return 'Update ' + appName('of', data.app) + ' started from v' + data.fromManifest.version + ' to v' + data.toManifest.version;

        case ACTION_APP_UPDATE_FINISH:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' was updated to v' + data.app.manifest.version;

        case ACTION_APP_BACKUP:
            if (!data.app) return '';
            return 'Backup ' + appName('of', data.app) + ' started';

        case ACTION_APP_BACKUP_FINISH:
            if (!data.app) return '';
            if (data.errorMessage) {
                return 'Backup ' + appName('of', data.app) + ' failed: ' + data.errorMessage;
            } else {
                return 'Backup ' + appName('of', data.app) + ' succeeded with backup id ' + data.backupId + ' at ' + data.remotePath;
            }

        case ACTION_APP_CLONE:
            if (appIdContext === data.oldAppId) {
                return 'App was cloned to ' + data.newApp.fqdn + ' using backup at ' + data.remotePath;
            } else if (appIdContext === data.appId) {
                return 'App was cloned from ' + data.oldApp.fqdn + ' using backup at ' + data.remotePath;
            } else {
                return appName('', data.newApp, 'App') + ' was cloned ' + appName('from', data.oldApp) + ' using backup at ' + data.remotePath;
            }

        case ACTION_APP_REPAIR:
            return appName('', data.app, 'App') + ' was re-configured'; // re-configure of email apps is more common?

        case ACTION_APP_LOGIN: {
            app = this.getCachedAppSync(data.appId);
            if (!app) return '';
            return 'App ' + app.fqdn + ' logged in';
        }

        case ACTION_APP_OOM:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' ran out of memory';

        case ACTION_APP_DOWN:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' is down';

        case ACTION_APP_UP:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' is back online';

        case ACTION_APP_START:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' was started';

        case ACTION_APP_STOP:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' was stopped';

        case ACTION_APP_RESTART:
            if (!data.app) return '';
            return appName('', data.app, 'App') + ' was restarted';

        case ACTION_BACKUP_START:
            return 'Backup started';

        case ACTION_BACKUP_FINISH:
            if (!errorMessage) {
                return 'Cloudron backup created at ' + data.remotePath;
            } else {
                return 'Cloudron backup errored with error: ' + errorMessage;
            }

        case ACTION_BACKUP_CLEANUP_START:
            return 'Backup cleaner started';

        case ACTION_BACKUP_CLEANUP_FINISH:
            return data.errorMessage ? 'Backup cleaner errored: ' + data.errorMessage : 'Backup cleaner removed ' + (data.removedBoxBackupPaths ? data.removedBoxBackupPaths.length : '0') + ' backups';

        case ACTION_CERTIFICATE_NEW:
            return 'Certificate install for ' + data.domain + (errorMessage ? ' failed' : ' succeeded');

        case ACTION_CERTIFICATE_RENEWAL:
            return 'Certificate renewal for ' + data.domain + (errorMessage ? ' failed' : ' succeeded');

        case ACTION_CERTIFICATE_CLEANUP:
            return 'Certificate(s) of ' + data.domains.join(',') + ' was cleaned up since they expired 6 months ago';

        case ACTION_DASHBOARD_DOMAIN_UPDATE:
            return 'Dashboard domain set to ' + data.fqdn;

        case ACTION_DOMAIN_ADD:
            return 'Domain ' + data.domain + ' with ' + data.provider + ' provider was added';

        case ACTION_DOMAIN_UPDATE:
            return 'Domain ' + data.domain + ' with ' + data.provider + ' provider was updated';

        case ACTION_DOMAIN_REMOVE:
            return 'Domain ' + data.domain + ' was removed';

        case ACTION_INSTALL_FINISH:
            return 'Cloudron version ' + data.version + ' installed';

        case ACTION_MAIL_LOCATION:
            return 'Mail server location was changed to ' + data.subdomain + (data.subdomain ? '.' : '') + data.domain;

        case ACTION_MAIL_ENABLED:
            return 'Mail was enabled for domain ' + data.domain;

        case ACTION_MAIL_DISABLED:
            return 'Mail was disabled for domain ' + data.domain;

        case ACTION_MAIL_MAILBOX_ADD:
            return 'Mailbox ' + data.name + '@' + data.domain + ' was added';

        case ACTION_MAIL_MAILBOX_UPDATE:
            if (data.aliases) {
                return 'Mailbox aliases of ' + data.name + '@' + data.domain + ' was updated';
            } else {
                return 'Mailbox ' + data.name + '@' + data.domain + ' was updated';
            }

        case ACTION_MAIL_MAILBOX_REMOVE:
            return 'Mailbox ' + data.name + '@' + data.domain + ' was removed';

        case ACTION_MAIL_LIST_ADD:
            return 'Mail list ' + data.name + '@' + data.domain + 'was added';

        case ACTION_MAIL_LIST_UPDATE:
            return 'Mail list ' + data.name + '@' + data.domain + ' was updated';

        case ACTION_MAIL_LIST_REMOVE:
            return 'Mail list ' + data.name + '@' + data.domain + ' was removed';

        case ACTION_START:
            return 'Cloudron started with version ' + data.version;

        case ACTION_SERVICE_CONFIGURE:
            return 'Service ' + data.id + ' was configured';

        case ACTION_SERVICE_REBUILD:
            return 'Service ' + data.id + ' was rebuilt';

        case ACTION_SERVICE_RESTART:
            return 'Service ' + data.id + ' was restarted';

        case ACTION_UPDATE:
            return 'Cloudron update to version ' + data.boxUpdateInfo.version + ' was started';

        case ACTION_UPDATE_FINISH:
            if (data.errorMessage) {
                return 'Cloudron update errored. Error: ' + data.errorMessage;
            } else {
                return 'Cloudron updated to version ' + data.newVersion;
            }

        case ACTION_USER_ADD:
            return data.email + (data.user.username ? ' (' + data.user.username + ')' : '') + ' was added';

        case ACTION_USER_UPDATE:
            return (data.user ? (data.user.email + (data.user.username ? ' (' + data.user.username + ')' : '')) : data.userId) + ' was updated';

        case ACTION_USER_REMOVE:
            return (data.user ? (data.user.email + (data.user.username ? ' (' + data.user.username + ')' : '')) : data.userId) + ' was removed';

        case ACTION_USER_TRANSFER:
            return 'Apps of ' + data.oldOwnerId + ' was transferred to ' + data.newOwnerId;

        case ACTION_USER_LOGIN:
            return (data.user ? data.user.username : data.userId) + ' logged in';

        case ACTION_USER_LOGOUT:
            return (data.user ? data.user.username : data.userId) + ' logged out';

        case ACTION_DYNDNS_UPDATE: {
            details = '';
            if (data.fromIpv4 !== data.toIpv4) details += 'DNS was updated from IPv4 ' + data.fromIpv4 + ' to ' + data.toIpv4 + '. ';
            if (data.fromIpv6 !== data.toIpv6) details += 'DNS was updated from IPv6 ' + data.fromIpv6 + ' to ' + data.toIpv6 + '.';
            return details;
        }

        case ACTION_SUPPORT_SSH:
            return 'Remote Support was ' + (data.enable ? 'enabled' : 'disabled');

        case ACTION_SUPPORT_TICKET:
            return 'Support ticket was created';

        case ACTION_SYSTEM_CRASH:
            return 'A system process crashed';

        case ACTION_VOLUME_ADD:
            return 'Volume "' + data.volume.name + '" was added';

        case ACTION_VOLUME_UPDATE:
            return 'Volme "' + data.volume.name + '" was updated';

        case ACTION_VOLUME_REMOVE:
            return 'Volume "' + data.volume.name + '" was removed';

        default: return eventLog.action;
        }
    }

    Client.prototype.eventLogSource = function (eventLog) {
        var source = eventLog.source;
        var line = '';

        line = source.username || source.userId || source.mailboxId || source.authType || 'system';
        if (source.appId) {
            var app = this.getCachedAppSync(source.appId);
            line += ' - ' + (app ? app.fqdn : source.appId);
        } else if (source.ip) {
            line += ' - ' + source.ip;
        }

        return line;
    }


    client = new Client();
    return client;
}]);
;/* This file contains helpers which should not be part of client.js */

angular.module('Application').directive('passwordReveal', function () {
    var svgEye = '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="eye" class="svg-inline--fa fa-eye fa-w-18" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor" d="M572.52 241.4C518.29 135.59 410.93 64 288 64S57.68 135.64 3.48 241.41a32.35 32.35 0 0 0 0 29.19C57.71 376.41 165.07 448 288 448s230.32-71.64 284.52-177.41a32.35 32.35 0 0 0 0-29.19zM288 400a144 144 0 1 1 144-144 143.93 143.93 0 0 1-144 144zm0-240a95.31 95.31 0 0 0-25.31 3.79 47.85 47.85 0 0 1-66.9 66.9A95.78 95.78 0 1 0 288 160z"></path></svg>';
    var svgEyeSlash = '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="eye-slash" class="svg-inline--fa fa-eye-slash fa-w-20" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="currentColor" d="M320 400c-75.85 0-137.25-58.71-142.9-133.11L72.2 185.82c-13.79 17.3-26.48 35.59-36.72 55.59a32.35 32.35 0 0 0 0 29.19C89.71 376.41 197.07 448 320 448c26.91 0 52.87-4 77.89-10.46L346 397.39a144.13 144.13 0 0 1-26 2.61zm313.82 58.1l-110.55-85.44a331.25 331.25 0 0 0 81.25-102.07 32.35 32.35 0 0 0 0-29.19C550.29 135.59 442.93 64 320 64a308.15 308.15 0 0 0-147.32 37.7L45.46 3.37A16 16 0 0 0 23 6.18L3.37 31.45A16 16 0 0 0 6.18 53.9l588.36 454.73a16 16 0 0 0 22.46-2.81l19.64-25.27a16 16 0 0 0-2.82-22.45zm-183.72-142l-39.3-30.38A94.75 94.75 0 0 0 416 256a94.76 94.76 0 0 0-121.31-92.21A47.65 47.65 0 0 1 304 192a46.64 46.64 0 0 1-1.54 10l-73.61-56.89A142.31 142.31 0 0 1 320 112a143.92 143.92 0 0 1 144 144c0 21.63-5.29 41.79-13.9 60.11z"></path></svg>';

    return {
        link: function (scope, elements) {
            var element = elements[0];

            if (!element.parentNode)  {
                console.error('Wrong password-reveal directive usage. Element has no parent.');
                return;
            }

            var eye = document.createElement('i');
            eye.innerHTML = svgEyeSlash;
            eye.style.width = '18px';
            eye.style.height = '18px';
            eye.style.position = 'relative';
            eye.style.float = 'right';
            eye.style.marginTop = '-24px';
            eye.style.marginRight = '10px';
            eye.style.cursor = 'pointer';

            eye.addEventListener('click', function () {
                if (element.type === 'password') {
                    element.type = 'text';
                    eye.innerHTML = svgEye;
                } else {
                    element.type = 'password';
                    eye.innerHTML = svgEyeSlash;
                }
            });

            element.parentNode.style.position = 'relative';
            element.parentNode.insertBefore(eye, element.nextSibling);
        }
    };
});
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNldHVwZG5zLmpzIiwiY2xpZW50LmpzIiwidXRpbHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsQ0NwVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxDQ2prSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoic2V0dXBkbnMuanMiLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIHN0cmljdCc7XG5cbi8qIGdsb2JhbCAkLCB0bGQsIGFuZ3VsYXIsIENsaXBib2FyZCAqL1xuXG4vLyBjcmVhdGUgbWFpbiBhcHBsaWNhdGlvbiBtb2R1bGVcbnZhciBhcHAgPSBhbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nLCBbJ3Bhc2NhbHByZWNodC50cmFuc2xhdGUnLCAnbmdDb29raWVzJywgJ2FuZ3VsYXItbWQ1JywgJ3VpLW5vdGlmaWNhdGlvbicsICd1aS5ib290c3RyYXAnXSk7XG5cbmFwcC5maWx0ZXIoJ3pvbmVOYW1lJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoZG9tYWluKSB7XG4gICAgICAgIHJldHVybiB0bGQuZ2V0RG9tYWluKGRvbWFpbik7XG4gICAgfTtcbn0pO1xuXG5hcHAuY29udHJvbGxlcignU2V0dXBETlNDb250cm9sbGVyJywgWyckc2NvcGUnLCAnJGh0dHAnLCAnJHRpbWVvdXQnLCAnQ2xpZW50JywgZnVuY3Rpb24gKCRzY29wZSwgJGh0dHAsICR0aW1lb3V0LCBDbGllbnQpIHtcbiAgICB2YXIgc2VhcmNoID0gZGVjb2RlVVJJQ29tcG9uZW50KHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpLnNsaWNlKDEpLnNwbGl0KCcmJykubWFwKGZ1bmN0aW9uIChpdGVtKSB7IHJldHVybiBpdGVtLnNwbGl0KCc9Jyk7IH0pLnJlZHVjZShmdW5jdGlvbiAobywgaykgeyBvW2tbMF1dID0ga1sxXTsgcmV0dXJuIG87IH0sIHt9KTtcblxuICAgICRzY29wZS5zdGF0ZSA9IG51bGw7IC8vICdpbml0aWFsaXplZCcsICd3YWl0aW5nRm9yRG5zU2V0dXAnLCAnd2FpdGluZ0ZvckJveCdcbiAgICAkc2NvcGUuZXJyb3IgPSB7fTtcbiAgICAkc2NvcGUucHJvdmlkZXIgPSAnJztcbiAgICAkc2NvcGUuc2hvd0ROU1NldHVwID0gZmFsc2U7XG4gICAgJHNjb3BlLmluc3RhbmNlSWQgPSAnJztcbiAgICAkc2NvcGUuaXNEb21haW4gPSBmYWxzZTtcbiAgICAkc2NvcGUuaXNTdWJkb21haW4gPSBmYWxzZTtcbiAgICAkc2NvcGUuYWR2YW5jZWRWaXNpYmxlID0gZmFsc2U7XG4gICAgJHNjb3BlLmNsaXBib2FyZERvbmUgPSBmYWxzZTtcbiAgICAkc2NvcGUuc2VhcmNoID0gd2luZG93LmxvY2F0aW9uLnNlYXJjaDtcbiAgICAkc2NvcGUuc2V0dXBUb2tlbiA9ICcnO1xuXG4gICAgJHNjb3BlLnRsc1Byb3ZpZGVyID0gW1xuICAgICAgICB7IG5hbWU6ICdMZXRcXCdzIEVuY3J5cHQgUHJvZCcsIHZhbHVlOiAnbGV0c2VuY3J5cHQtcHJvZCcgfSxcbiAgICAgICAgeyBuYW1lOiAnTGV0XFwncyBFbmNyeXB0IFByb2QgLSBXaWxkY2FyZCcsIHZhbHVlOiAnbGV0c2VuY3J5cHQtcHJvZC13aWxkY2FyZCcgfSxcbiAgICAgICAgeyBuYW1lOiAnTGV0XFwncyBFbmNyeXB0IFN0YWdpbmcnLCB2YWx1ZTogJ2xldHNlbmNyeXB0LXN0YWdpbmcnIH0sXG4gICAgICAgIHsgbmFtZTogJ0xldFxcJ3MgRW5jcnlwdCBTdGFnaW5nIC0gV2lsZGNhcmQnLCB2YWx1ZTogJ2xldHNlbmNyeXB0LXN0YWdpbmctd2lsZGNhcmQnIH0sXG4gICAgICAgIHsgbmFtZTogJ1NlbGYtU2lnbmVkJywgdmFsdWU6ICdmYWxsYmFjaycgfSwgLy8gdGhpcyBpcyBub3QgJ0N1c3RvbScgYmVjYXVzZSB3ZSBkb24ndCBhbGxvdyB1c2VyIHRvIHVwbG9hZCBjZXJ0cyBkdXJpbmcgc2V0dXAgcGhhc2VcbiAgICBdO1xuXG4gICAgJHNjb3BlLnN5c2luZm8gPSB7XG4gICAgICAgIHByb3ZpZGVyOiAnZ2VuZXJpYycsXG4gICAgICAgIGlwOiAnJyxcbiAgICAgICAgaWZuYW1lOiAnJ1xuICAgIH07XG5cbiAgICAkc2NvcGUuc3lzaW5mb1Byb3ZpZGVyID0gW1xuICAgICAgICB7IG5hbWU6ICdQdWJsaWMgSVAnLCB2YWx1ZTogJ2dlbmVyaWMnIH0sXG4gICAgICAgIHsgbmFtZTogJ1N0YXRpYyBJUCBBZGRyZXNzJywgdmFsdWU6ICdmaXhlZCcgfSxcbiAgICAgICAgeyBuYW1lOiAnTmV0d29yayBJbnRlcmZhY2UnLCB2YWx1ZTogJ25ldHdvcmstaW50ZXJmYWNlJyB9XG4gICAgXTtcblxuICAgICRzY29wZS5wcmV0dHlTeXNpbmZvUHJvdmlkZXJOYW1lID0gZnVuY3Rpb24gKHByb3ZpZGVyKSB7XG4gICAgICAgIHN3aXRjaCAocHJvdmlkZXIpIHtcbiAgICAgICAgY2FzZSAnZ2VuZXJpYyc6IHJldHVybiAnUHVibGljIElQJztcbiAgICAgICAgY2FzZSAnZml4ZWQnOiByZXR1cm4gJ1N0YXRpYyBJUCBBZGRyZXNzJztcbiAgICAgICAgY2FzZSAnbmV0d29yay1pbnRlcmZhY2UnOiByZXR1cm4gJ05ldHdvcmsgSW50ZXJmYWNlJztcbiAgICAgICAgZGVmYXVsdDogcmV0dXJuICdVbmtub3duJztcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkc2NvcGUubmVlZHNQb3J0ODAgPSBmdW5jdGlvbiAoZG5zUHJvdmlkZXIsIHRsc1Byb3ZpZGVyKSB7XG4gICAgICAgIHJldHVybiAoKGRuc1Byb3ZpZGVyID09PSAnbWFudWFsJyB8fCBkbnNQcm92aWRlciA9PT0gJ25vb3AnIHx8IGRuc1Byb3ZpZGVyID09PSAnd2lsZGNhcmQnKSAmJlxuICAgICAgICAgICAgKHRsc1Byb3ZpZGVyID09PSAnbGV0c2VuY3J5cHQtcHJvZCcgfHwgdGxzUHJvdmlkZXIgPT09ICdsZXRzZW5jcnlwdC1zdGFnaW5nJykpO1xuICAgIH07XG5cbiAgICAvLyBJZiB3ZSBtaWdyYXRlIHRoZSBhcGkgb3JpZ2luIHdlIGhhdmUgdG8gcG9sbCB0aGUgbmV3IGxvY2F0aW9uXG4gICAgaWYgKHNlYXJjaC5hZG1pbl9mcWRuKSBDbGllbnQuYXBpT3JpZ2luID0gJ2h0dHBzOi8vJyArIHNlYXJjaC5hZG1pbl9mcWRuO1xuXG4gICAgJHNjb3BlLiR3YXRjaCgnZG5zQ3JlZGVudGlhbHMuZG9tYWluJywgZnVuY3Rpb24gKG5ld1ZhbCkge1xuICAgICAgICBpZiAoIW5ld1ZhbCkge1xuICAgICAgICAgICAgJHNjb3BlLmlzRG9tYWluID0gZmFsc2U7XG4gICAgICAgICAgICAkc2NvcGUuaXNTdWJkb21haW4gPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICghdGxkLmdldERvbWFpbihuZXdWYWwpIHx8IG5ld1ZhbFtuZXdWYWwubGVuZ3RoLTFdID09PSAnLicpIHtcbiAgICAgICAgICAgICRzY29wZS5pc0RvbWFpbiA9IGZhbHNlO1xuICAgICAgICAgICAgJHNjb3BlLmlzU3ViZG9tYWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkc2NvcGUuaXNEb21haW4gPSB0cnVlO1xuICAgICAgICAgICAgJHNjb3BlLmlzU3ViZG9tYWluID0gdGxkLmdldERvbWFpbihuZXdWYWwpICE9PSBuZXdWYWw7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIGtlZXAgaW4gc3luYyB3aXRoIGRvbWFpbnMuanNcbiAgICAkc2NvcGUuZG5zUHJvdmlkZXIgPSBbXG4gICAgICAgIHsgbmFtZTogJ0FXUyBSb3V0ZTUzJywgdmFsdWU6ICdyb3V0ZTUzJyB9LFxuICAgICAgICB7IG5hbWU6ICdDbG91ZGZsYXJlJywgdmFsdWU6ICdjbG91ZGZsYXJlJyB9LFxuICAgICAgICB7IG5hbWU6ICdEaWdpdGFsT2NlYW4nLCB2YWx1ZTogJ2RpZ2l0YWxvY2VhbicgfSxcbiAgICAgICAgeyBuYW1lOiAnR2FuZGkgTGl2ZUROUycsIHZhbHVlOiAnZ2FuZGknIH0sXG4gICAgICAgIHsgbmFtZTogJ0dvRGFkZHknLCB2YWx1ZTogJ2dvZGFkZHknIH0sXG4gICAgICAgIHsgbmFtZTogJ0dvb2dsZSBDbG91ZCBETlMnLCB2YWx1ZTogJ2djZG5zJyB9LFxuICAgICAgICB7IG5hbWU6ICdIZXR6bmVyJywgdmFsdWU6ICdoZXR6bmVyJyB9LFxuICAgICAgICB7IG5hbWU6ICdMaW5vZGUnLCB2YWx1ZTogJ2xpbm9kZScgfSxcbiAgICAgICAgeyBuYW1lOiAnTmFtZS5jb20nLCB2YWx1ZTogJ25hbWVjb20nIH0sXG4gICAgICAgIHsgbmFtZTogJ05hbWVjaGVhcCcsIHZhbHVlOiAnbmFtZWNoZWFwJyB9LFxuICAgICAgICB7IG5hbWU6ICdOZXRjdXAnLCB2YWx1ZTogJ25ldGN1cCcgfSxcbiAgICAgICAgeyBuYW1lOiAnVnVsdHInLCB2YWx1ZTogJ3Z1bHRyJyB9LFxuICAgICAgICB7IG5hbWU6ICdXaWxkY2FyZCcsIHZhbHVlOiAnd2lsZGNhcmQnIH0sXG4gICAgICAgIHsgbmFtZTogJ01hbnVhbCAobm90IHJlY29tbWVuZGVkKScsIHZhbHVlOiAnbWFudWFsJyB9LFxuICAgICAgICB7IG5hbWU6ICdOby1vcCAob25seSBmb3IgZGV2ZWxvcG1lbnQpJywgdmFsdWU6ICdub29wJyB9XG4gICAgXTtcbiAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMgPSB7XG4gICAgICAgIGJ1c3k6IGZhbHNlLFxuICAgICAgICBkb21haW46ICcnLFxuICAgICAgICBhY2Nlc3NLZXlJZDogJycsXG4gICAgICAgIHNlY3JldEFjY2Vzc0tleTogJycsXG4gICAgICAgIGdjZG5zS2V5OiB7IGtleUZpbGVOYW1lOiAnJywgY29udGVudDogJycgfSxcbiAgICAgICAgZGlnaXRhbE9jZWFuVG9rZW46ICcnLFxuICAgICAgICBnYW5kaUFwaUtleTogJycsXG4gICAgICAgIGNsb3VkZmxhcmVFbWFpbDogJycsXG4gICAgICAgIGNsb3VkZmxhcmVUb2tlbjogJycsXG4gICAgICAgIGNsb3VkZmxhcmVUb2tlblR5cGU6ICdHbG9iYWxBcGlLZXknLFxuICAgICAgICBnb2RhZGR5QXBpS2V5OiAnJyxcbiAgICAgICAgZ29kYWRkeUFwaVNlY3JldDogJycsXG4gICAgICAgIGxpbm9kZVRva2VuOiAnJyxcbiAgICAgICAgaGV0em5lclRva2VuOiAnJyxcbiAgICAgICAgdnVsdHJUb2tlbjogJycsXG4gICAgICAgIG5hbWVDb21Vc2VybmFtZTogJycsXG4gICAgICAgIG5hbWVDb21Ub2tlbjogJycsXG4gICAgICAgIG5hbWVjaGVhcFVzZXJuYW1lOiAnJyxcbiAgICAgICAgbmFtZWNoZWFwQXBpS2V5OiAnJyxcbiAgICAgICAgbmV0Y3VwQ3VzdG9tZXJOdW1iZXI6ICcnLFxuICAgICAgICBuZXRjdXBBcGlLZXk6ICcnLFxuICAgICAgICBuZXRjdXBBcGlQYXNzd29yZDogJycsXG4gICAgICAgIHByb3ZpZGVyOiAncm91dGU1MycsXG4gICAgICAgIHpvbmVOYW1lOiAnJyxcbiAgICAgICAgdGxzQ29uZmlnOiB7XG4gICAgICAgICAgICBwcm92aWRlcjogJ2xldHNlbmNyeXB0LXByb2Qtd2lsZGNhcmQnXG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJHNjb3BlLnNldERlZmF1bHRUbHNQcm92aWRlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGRuc1Byb3ZpZGVyID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyO1xuICAgICAgICAvLyB3aWxkY2FyZCBMRSB3b24ndCB3b3JrIHdpdGhvdXQgYXV0b21hdGVkIEROU1xuICAgICAgICBpZiAoZG5zUHJvdmlkZXIgPT09ICdtYW51YWwnIHx8IGRuc1Byb3ZpZGVyID09PSAnbm9vcCcgfHwgZG5zUHJvdmlkZXIgPT09ICd3aWxkY2FyZCcpIHtcbiAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy50bHNDb25maWcucHJvdmlkZXIgPSAnbGV0c2VuY3J5cHQtcHJvZCc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMudGxzQ29uZmlnLnByb3ZpZGVyID0gJ2xldHNlbmNyeXB0LXByb2Qtd2lsZGNhcmQnO1xuICAgICAgICB9XG4gICAgfTtcblxuXG4gICAgZnVuY3Rpb24gcmVhZEZpbGVMb2NhbGx5KG9iaiwgZmlsZSwgZmlsZU5hbWUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgJHNjb3BlLiRhcHBseShmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgb2JqW2ZpbGVdID0gbnVsbDtcbiAgICAgICAgICAgICAgICBvYmpbZmlsZU5hbWVdID0gZXZlbnQudGFyZ2V0LmZpbGVzWzBdLm5hbWU7XG5cbiAgICAgICAgICAgICAgICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgICAgICAgICAgICAgICByZWFkZXIub25sb2FkID0gZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdC50YXJnZXQgfHwgIXJlc3VsdC50YXJnZXQucmVzdWx0KSByZXR1cm4gY29uc29sZS5lcnJvcignVW5hYmxlIHRvIHJlYWQgbG9jYWwgZmlsZScpO1xuICAgICAgICAgICAgICAgICAgICBvYmpbZmlsZV0gPSByZXN1bHQudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJlYWRlci5yZWFkQXNUZXh0KGV2ZW50LnRhcmdldC5maWxlc1swXSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ2NkbnNLZXlGaWxlSW5wdXQnKS5vbmNoYW5nZSA9IHJlYWRGaWxlTG9jYWxseSgkc2NvcGUuZG5zQ3JlZGVudGlhbHMuZ2NkbnNLZXksICdjb250ZW50JywgJ2tleUZpbGVOYW1lJyk7XG5cbiAgICAkc2NvcGUuc2V0RG5zQ3JlZGVudGlhbHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5idXN5ID0gdHJ1ZTtcbiAgICAgICAgJHNjb3BlLmVycm9yID0ge307XG5cbiAgICAgICAgdmFyIHByb3ZpZGVyID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyO1xuXG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBpZiAocHJvdmlkZXIgPT09ICdyb3V0ZTUzJykge1xuICAgICAgICAgICAgY29uZmlnLmFjY2Vzc0tleUlkID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmFjY2Vzc0tleUlkO1xuICAgICAgICAgICAgY29uZmlnLnNlY3JldEFjY2Vzc0tleSA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5zZWNyZXRBY2Nlc3NLZXk7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICdnY2RucycpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdmFyIHNlcnZpY2VBY2NvdW50S2V5ID0gSlNPTi5wYXJzZSgkc2NvcGUuZG5zQ3JlZGVudGlhbHMuZ2NkbnNLZXkuY29udGVudCk7XG4gICAgICAgICAgICAgICAgY29uZmlnLnByb2plY3RJZCA9IHNlcnZpY2VBY2NvdW50S2V5LnByb2plY3RfaWQ7XG4gICAgICAgICAgICAgICAgY29uZmlnLmNyZWRlbnRpYWxzID0ge1xuICAgICAgICAgICAgICAgICAgICBjbGllbnRfZW1haWw6IHNlcnZpY2VBY2NvdW50S2V5LmNsaWVudF9lbWFpbCxcbiAgICAgICAgICAgICAgICAgICAgcHJpdmF0ZV9rZXk6IHNlcnZpY2VBY2NvdW50S2V5LnByaXZhdGVfa2V5XG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIGlmICghY29uZmlnLnByb2plY3RJZCB8fCAhY29uZmlnLmNyZWRlbnRpYWxzIHx8ICFjb25maWcuY3JlZGVudGlhbHMuY2xpZW50X2VtYWlsIHx8ICFjb25maWcuY3JlZGVudGlhbHMucHJpdmF0ZV9rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdPbmUgb3IgbW9yZSBmaWVsZHMgYXJlIG1pc3NpbmcgaW4gdGhlIEpTT04nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmVycm9yLmRuc0NyZWRlbnRpYWxzID0gJ0Nhbm5vdCBwYXJzZSBHb29nbGUgU2VydmljZSBBY2NvdW50IEtleTogJyArIGUubWVzc2FnZTtcbiAgICAgICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuYnVzeSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2RpZ2l0YWxvY2VhbicpIHtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5kaWdpdGFsT2NlYW5Ub2tlbjtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2dhbmRpJykge1xuICAgICAgICAgICAgY29uZmlnLnRva2VuID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmdhbmRpQXBpS2V5O1xuICAgICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnZ29kYWRkeScpIHtcbiAgICAgICAgICAgIGNvbmZpZy5hcGlLZXkgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuZ29kYWRkeUFwaUtleTtcbiAgICAgICAgICAgIGNvbmZpZy5hcGlTZWNyZXQgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuZ29kYWRkeUFwaVNlY3JldDtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2Nsb3VkZmxhcmUnKSB7XG4gICAgICAgICAgICBjb25maWcuZW1haWwgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuY2xvdWRmbGFyZUVtYWlsO1xuICAgICAgICAgICAgY29uZmlnLnRva2VuID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLmNsb3VkZmxhcmVUb2tlbjtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlblR5cGUgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuY2xvdWRmbGFyZVRva2VuVHlwZTtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2xpbm9kZScpIHtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5saW5vZGVUb2tlbjtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ2hldHpuZXInKSB7XG4gICAgICAgICAgICBjb25maWcudG9rZW4gPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuaGV0em5lclRva2VuO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAndnVsdHInKSB7XG4gICAgICAgICAgICBjb25maWcudG9rZW4gPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMudnVsdHJUb2tlbjtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ25hbWVjb20nKSB7XG4gICAgICAgICAgICBjb25maWcudXNlcm5hbWUgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubmFtZUNvbVVzZXJuYW1lO1xuICAgICAgICAgICAgY29uZmlnLnRva2VuID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLm5hbWVDb21Ub2tlbjtcbiAgICAgICAgfSBlbHNlIGlmIChwcm92aWRlciA9PT0gJ25hbWVjaGVhcCcpIHtcbiAgICAgICAgICAgIGNvbmZpZy50b2tlbiA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5uYW1lY2hlYXBBcGlLZXk7XG4gICAgICAgICAgICBjb25maWcudXNlcm5hbWUgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubmFtZWNoZWFwVXNlcm5hbWU7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvdmlkZXIgPT09ICduZXRjdXAnKSB7XG4gICAgICAgICAgICBjb25maWcuY3VzdG9tZXJOdW1iZXIgPSAkc2NvcGUuZG5zQ3JlZGVudGlhbHMubmV0Y3VwQ3VzdG9tZXJOdW1iZXI7XG4gICAgICAgICAgICBjb25maWcuYXBpS2V5ID0gJHNjb3BlLmRuc0NyZWRlbnRpYWxzLm5ldGN1cEFwaUtleTtcbiAgICAgICAgICAgIGNvbmZpZy5hcGlQYXNzd29yZCA9ICRzY29wZS5kbnNDcmVkZW50aWFscy5uZXRjdXBBcGlQYXNzd29yZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB0bHNDb25maWcgPSB7XG4gICAgICAgICAgICBwcm92aWRlcjogJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnRsc0NvbmZpZy5wcm92aWRlcixcbiAgICAgICAgICAgIHdpbGRjYXJkOiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICBpZiAoJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnRsc0NvbmZpZy5wcm92aWRlci5pbmRleE9mKCctd2lsZGNhcmQnKSAhPT0gLTEpIHtcbiAgICAgICAgICAgIHRsc0NvbmZpZy5wcm92aWRlciA9IHRsc0NvbmZpZy5wcm92aWRlci5yZXBsYWNlKCctd2lsZGNhcmQnLCAnJyk7XG4gICAgICAgICAgICB0bHNDb25maWcud2lsZGNhcmQgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHN5c2luZm9Db25maWcgPSB7XG4gICAgICAgICAgICBwcm92aWRlcjogJHNjb3BlLnN5c2luZm8ucHJvdmlkZXJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCRzY29wZS5zeXNpbmZvLnByb3ZpZGVyID09PSAnZml4ZWQnKSB7XG4gICAgICAgICAgICBzeXNpbmZvQ29uZmlnLmlwID0gJHNjb3BlLnN5c2luZm8uaXA7XG4gICAgICAgIH0gZWxzZSBpZiAoJHNjb3BlLnN5c2luZm8ucHJvdmlkZXIgPT09ICduZXR3b3JrLWludGVyZmFjZScpIHtcbiAgICAgICAgICAgIHN5c2luZm9Db25maWcuaWZuYW1lID0gJHNjb3BlLnN5c2luZm8uaWZuYW1lO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBkb21haW5Db25maWc6IHtcbiAgICAgICAgICAgICAgICBkb21haW46ICRzY29wZS5kbnNDcmVkZW50aWFscy5kb21haW4sXG4gICAgICAgICAgICAgICAgem9uZU5hbWU6ICRzY29wZS5kbnNDcmVkZW50aWFscy56b25lTmFtZSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcjogcHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgY29uZmlnOiBjb25maWcsXG4gICAgICAgICAgICAgICAgdGxzQ29uZmlnOiB0bHNDb25maWdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzeXNpbmZvQ29uZmlnOiBzeXNpbmZvQ29uZmlnLFxuICAgICAgICAgICAgcHJvdmlkZXJUb2tlbjogJHNjb3BlLmluc3RhbmNlSWQsXG4gICAgICAgICAgICBzZXR1cFRva2VuOiAkc2NvcGUuc2V0dXBUb2tlblxuICAgICAgICB9O1xuXG4gICAgICAgIENsaWVudC5zZXR1cChkYXRhLCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yLnN0YXR1c0NvZGUgPT09IDQyMikge1xuICAgICAgICAgICAgICAgICAgICBpZiAocHJvdmlkZXIgPT09ICdhbWknKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAkc2NvcGUuZXJyb3IuYW1pID0gZXJyb3IubWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICRzY29wZS5lcnJvci5zZXR1cCA9IGVycm9yLm1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAkc2NvcGUuZXJyb3IuZG5zQ3JlZGVudGlhbHMgPSBlcnJvci5tZXNzYWdlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHdhaXRGb3JEbnNTZXR1cCgpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gd2FpdEZvckRuc1NldHVwKCkge1xuICAgICAgICAkc2NvcGUuc3RhdGUgPSAnd2FpdGluZ0ZvckRuc1NldHVwJztcblxuICAgICAgICBDbGllbnQuZ2V0U3RhdHVzKGZ1bmN0aW9uIChlcnJvciwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoIWVycm9yICYmICFzdGF0dXMuc2V0dXAuYWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0dXMuYWRtaW5GcWRuIHx8IHN0YXR1cy5zZXR1cC5lcnJvck1lc3NhZ2UpIHsgLy8gc2V0dXAgcmVzZXQgb3IgZXJyb3JlZC4gc3RhcnQgb3ZlclxuICAgICAgICAgICAgICAgICAgICAkc2NvcGUuZXJyb3Iuc2V0dXAgPSBzdGF0dXMuc2V0dXAuZXJyb3JNZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICAkc2NvcGUuc3RhdGUgPSAnaW5pdGlhbGl6ZWQnO1xuICAgICAgICAgICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMuYnVzeSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7IC8vIHByb2NlZWQgdG8gYWN0aXZhdGlvblxuICAgICAgICAgICAgICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9ICdodHRwczovLycgKyBzdGF0dXMuYWRtaW5GcWRuICsgJy9zZXR1cC5odG1sJyArICh3aW5kb3cubG9jYXRpb24uc2VhcmNoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAkc2NvcGUubWVzc2FnZSA9IHN0YXR1cy5zZXR1cC5tZXNzYWdlO1xuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHdhaXRGb3JEbnNTZXR1cCwgNTAwMCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgICAgIENsaWVudC5nZXRTdGF0dXMoZnVuY3Rpb24gKGVycm9yLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgIC8vIER1cmluZyBkb21haW4gbWlncmF0aW9uLCB0aGUgYm94IGNvZGUgcmVzdGFydHMgYW5kIGNhbiByZXN1bHQgaW4gZ2V0U3RhdHVzKCkgZmFpbGluZyB0ZW1wb3JhcmlseVxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgICRzY29wZS5zdGF0ZSA9ICd3YWl0aW5nRm9yQm94JztcbiAgICAgICAgICAgICAgICByZXR1cm4gJHRpbWVvdXQoaW5pdGlhbGl6ZSwgMzAwMCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGRvbWFpbiBpcyBjdXJyZW50bHkgbGlrZSBhIGxvY2sgZmxhZ1xuICAgICAgICAgICAgaWYgKHN0YXR1cy5hZG1pbkZxZG4pIHJldHVybiB3YWl0Rm9yRG5zU2V0dXAoKTtcblxuICAgICAgICAgICAgaWYgKHN0YXR1cy5wcm92aWRlciA9PT0gJ2RpZ2l0YWxvY2VhbicgfHwgc3RhdHVzLnByb3ZpZGVyID09PSAnZGlnaXRhbG9jZWFuLW1wJykge1xuICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlciA9ICdkaWdpdGFsb2NlYW4nO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMucHJvdmlkZXIgPT09ICdsaW5vZGUnIHx8IHN0YXR1cy5wcm92aWRlciA9PT0gJ2xpbm9kZS1vbmVjbGljaycgfHwgc3RhdHVzLnByb3ZpZGVyID09PSAnbGlub2RlLXN0YWNrc2NyaXB0Jykge1xuICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlciA9ICdsaW5vZGUnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMucHJvdmlkZXIgPT09ICd2dWx0cicgfHwgc3RhdHVzLnByb3ZpZGVyID09PSAndnVsdHItbXAnKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmRuc0NyZWRlbnRpYWxzLnByb3ZpZGVyID0gJ3Z1bHRyJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzLnByb3ZpZGVyID09PSAnZ2NlJykge1xuICAgICAgICAgICAgICAgICRzY29wZS5kbnNDcmVkZW50aWFscy5wcm92aWRlciA9ICdnY2Rucyc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cy5wcm92aWRlciA9PT0gJ2FtaScpIHtcbiAgICAgICAgICAgICAgICAkc2NvcGUuZG5zQ3JlZGVudGlhbHMucHJvdmlkZXIgPSAncm91dGU1Myc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICRzY29wZS5pbnN0YW5jZUlkID0gc2VhcmNoLmluc3RhbmNlSWQ7XG4gICAgICAgICAgICAkc2NvcGUuc2V0dXBUb2tlbiA9IHNlYXJjaC5zZXR1cFRva2VuO1xuICAgICAgICAgICAgJHNjb3BlLnByb3ZpZGVyID0gc3RhdHVzLnByb3ZpZGVyO1xuICAgICAgICAgICAgJHNjb3BlLnN0YXRlID0gJ2luaXRpYWxpemVkJztcblxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7ICQoXCJbYXV0b2ZvY3VzXTpmaXJzdFwiKS5mb2N1cygpOyB9LCAxMDApO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB2YXIgY2xpcGJvYXJkID0gbmV3IENsaXBib2FyZCgnLmNsaXBib2FyZCcpO1xuICAgIGNsaXBib2FyZC5vbignc3VjY2VzcycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgJHNjb3BlLiRhcHBseShmdW5jdGlvbiAoKSB7ICRzY29wZS5jbGlwYm9hcmREb25lID0gdHJ1ZTsgfSk7XG4gICAgICAgICR0aW1lb3V0KGZ1bmN0aW9uICgpIHsgJHNjb3BlLmNsaXBib2FyZERvbmUgPSBmYWxzZTsgfSwgNTAwMCk7XG4gICAgfSk7XG5cbiAgICBpbml0aWFsaXplKCk7XG59XSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qIGdsb2JhbCAkICovXG4vKiBnbG9iYWwgYW5ndWxhciAqL1xuLyogZ2xvYmFsIEV2ZW50U291cmNlICovXG4vKiBnbG9iYWwgYXN5bmMgKi9cblxuLy8ga2VlcCBpbiBzeW5jIHdpdGggYm94L3NyYy9hcHBzLmpzXG52YXIgSVNUQVRFUyA9IHtcbiAgICBQRU5ESU5HX0lOU1RBTEw6ICdwZW5kaW5nX2luc3RhbGwnLFxuICAgIFBFTkRJTkdfQ0xPTkU6ICdwZW5kaW5nX2Nsb25lJyxcbiAgICBQRU5ESU5HX0NPTkZJR1VSRTogJ3BlbmRpbmdfY29uZmlndXJlJyxcbiAgICBQRU5ESU5HX1VOSU5TVEFMTDogJ3BlbmRpbmdfdW5pbnN0YWxsJyxcbiAgICBQRU5ESU5HX1JFU1RPUkU6ICdwZW5kaW5nX3Jlc3RvcmUnLFxuICAgIFBFTkRJTkdfSU1QT1JUOiAncGVuZGluZ19pbXBvcnQnLFxuICAgIFBFTkRJTkdfVVBEQVRFOiAncGVuZGluZ191cGRhdGUnLFxuICAgIFBFTkRJTkdfQkFDS1VQOiAncGVuZGluZ19iYWNrdXAnLFxuICAgIFBFTkRJTkdfUkVDUkVBVEVfQ09OVEFJTkVSOiAncGVuZGluZ19yZWNyZWF0ZV9jb250YWluZXInLCAvLyBlbnYgY2hhbmdlIG9yIGFkZG9uIGNoYW5nZVxuICAgIFBFTkRJTkdfTE9DQVRJT05fQ0hBTkdFOiAncGVuZGluZ19sb2NhdGlvbl9jaGFuZ2UnLFxuICAgIFBFTkRJTkdfREFUQV9ESVJfTUlHUkFUSU9OOiAncGVuZGluZ19kYXRhX2Rpcl9taWdyYXRpb24nLFxuICAgIFBFTkRJTkdfUkVTSVpFOiAncGVuZGluZ19yZXNpemUnLFxuICAgIFBFTkRJTkdfREVCVUc6ICdwZW5kaW5nX2RlYnVnJyxcbiAgICBQRU5ESU5HX1NUQVJUOiAncGVuZGluZ19zdGFydCcsXG4gICAgUEVORElOR19TVE9QOiAncGVuZGluZ19zdG9wJyxcbiAgICBQRU5ESU5HX1JFU1RBUlQ6ICdwZW5kaW5nX3Jlc3RhcnQnLFxuICAgIEVSUk9SOiAnZXJyb3InLFxuICAgIElOU1RBTExFRDogJ2luc3RhbGxlZCdcbn07XG5cbnZhciBIU1RBVEVTID0ge1xuICAgIEhFQUxUSFk6ICdoZWFsdGh5JyxcbiAgICBVTkhFQUxUSFk6ICd1bmhlYWx0aHknLFxuICAgIEVSUk9SOiAnZXJyb3InLFxuICAgIERFQUQ6ICdkZWFkJ1xufTtcblxudmFyIFJTVEFURVMgPXtcbiAgICBSVU5OSU5HOiAncnVubmluZycsXG4gICAgU1RPUFBFRDogJ3N0b3BwZWQnXG59O1xuXG52YXIgRVJST1IgPSB7XG4gICAgQUNDRVNTX0RFTklFRDogJ0FjY2VzcyBEZW5pZWQnLFxuICAgIEFMUkVBRFlfRVhJU1RTOiAnQWxyZWFkeSBFeGlzdHMnLFxuICAgIEJBRF9GSUVMRDogJ0JhZCBGaWVsZCcsXG4gICAgQ09MTEVDVERfRVJST1I6ICdDb2xsZWN0ZCBFcnJvcicsXG4gICAgQ09ORkxJQ1Q6ICdDb25mbGljdCcsXG4gICAgREFUQUJBU0VfRVJST1I6ICdEYXRhYmFzZSBFcnJvcicsXG4gICAgRE5TX0VSUk9SOiAnRE5TIEVycm9yJyxcbiAgICBET0NLRVJfRVJST1I6ICdEb2NrZXIgRXJyb3InLFxuICAgIEVYVEVSTkFMX0VSUk9SOiAnRXh0ZXJuYWwgRXJyb3InLFxuICAgIEZTX0VSUk9SOiAnRmlsZVN5c3RlbSBFcnJvcicsXG4gICAgSU5URVJOQUxfRVJST1I6ICdJbnRlcm5hbCBFcnJvcicsXG4gICAgTE9HUk9UQVRFX0VSUk9SOiAnTG9ncm90YXRlIEVycm9yJyxcbiAgICBORVRXT1JLX0VSUk9SOiAnTmV0d29yayBFcnJvcicsXG4gICAgTk9UX0ZPVU5EOiAnTm90IGZvdW5kJyxcbiAgICBSRVZFUlNFUFJPWFlfRVJST1I6ICdSZXZlcnNlUHJveHkgRXJyb3InLFxuICAgIFRBU0tfRVJST1I6ICdUYXNrIEVycm9yJyxcbiAgICBVTktOT1dOX0VSUk9SOiAnVW5rbm93biBFcnJvcicgLy8gb25seSB1c2VkIGZvciBwb3J0aW4sXG59O1xuXG52YXIgUk9MRVMgPSB7XG4gICAgT1dORVI6ICdvd25lcicsXG4gICAgQURNSU46ICdhZG1pbicsXG4gICAgTUFJTF9NQU5BR0VSOiAnbWFpbG1hbmFnZXInLFxuICAgIFVTRVJfTUFOQUdFUjogJ3VzZXJtYW5hZ2VyJyxcbiAgICBVU0VSOiAndXNlcidcbn07XG5cbi8vIHN5bmMgdXAgd2l0aCB0YXNrcy5qc1xudmFyIFRBU0tfVFlQRVMgPSB7XG4gICAgVEFTS19BUFA6ICdhcHAnLFxuICAgIFRBU0tfQkFDS1VQOiAnYmFja3VwJyxcbiAgICBUQVNLX1VQREFURTogJ3VwZGF0ZScsXG4gICAgVEFTS19SRU5FV19DRVJUUzogJ3JlbmV3Y2VydHMnLFxuICAgIFRBU0tfU0VUVVBfRE5TX0FORF9DRVJUOiAnc2V0dXBEbnNBbmRDZXJ0JyxcbiAgICBUQVNLX0NMRUFOX0JBQ0tVUFM6ICdjbGVhbkJhY2t1cHMnLFxuICAgIFRBU0tfU1lOQ19FWFRFUk5BTF9MREFQOiAnc3luY0V4dGVybmFsTGRhcCcsXG4gICAgVEFTS19DSEFOR0VfTUFJTF9MT0NBVElPTjogJ2NoYW5nZU1haWxMb2NhdGlvbicsXG4gICAgVEFTS19TWU5DX0ROU19SRUNPUkRTOiAnc3luY0Ruc1JlY29yZHMnLFxufTtcblxudmFyIFNFQ1JFVF9QTEFDRUhPTERFUiA9IFN0cmluZy5mcm9tQ2hhckNvZGUoMHgyNUNGKS5yZXBlYXQoOCk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlbHBlciB0byBlbnN1cmUgbG9hZGluZyBhIGZhbGxiYWNrIGFwcCBpY29uIG9uIGZpcnN0IGxvYWQgZmFpbHVyZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZnVuY3Rpb24gaW1hZ2VFcnJvckhhbmRsZXIoZWxlbSkge1xuICAgIGVsZW0uc3JjID0gZWxlbS5nZXRBdHRyaWJ1dGUoJ2ZhbGxiYWNrLWljb24nKTtcbiAgICBlbGVtLm9uZXJyb3IgPSBudWxsOyAgICAvLyBhdm9pZCByZXRyeSBhZnRlciBkZWZhdWx0IGljb24gY2Fubm90IGJlIGxvYWRlZFxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTaGFyZWQgQW5ndWxhciBGaWx0ZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIGJpbmFyeSB1bml0cyAobm9uIFNJKSAxMDI0IGJhc2VkXG5mdW5jdGlvbiBwcmV0dHlCeXRlU2l6ZShzaXplLCBmYWxsYmFjaykge1xuICAgIGlmICghc2l6ZSkgcmV0dXJuIGZhbGxiYWNrIHx8IDA7XG5cbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoTWF0aC5sb2coc2l6ZSkgLyBNYXRoLmxvZygxMDI0KSk7XG4gICAgcmV0dXJuIChzaXplIC8gTWF0aC5wb3coMTAyNCwgaSkpLnRvRml4ZWQoMikgKiAxICsgJyAnICsgWydCJywgJ2tCJywgJ01CJywgJ0dCJywgJ1RCJ11baV07XG59XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigncHJldHR5Qnl0ZVNpemUnLCBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChzaXplLCBmYWxsYmFjaykgeyByZXR1cm4gcHJldHR5Qnl0ZVNpemUoc2l6ZSwgZmFsbGJhY2spIHx8ICcwIGtiJzsgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eURpc2tTaXplJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoc2l6ZSwgZmFsbGJhY2spIHsgcmV0dXJuIHByZXR0eUJ5dGVTaXplKHNpemUsIGZhbGxiYWNrKSB8fCAnTm90IGF2YWlsYWJsZSB5ZXQnOyB9O1xufSk7XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigndHJLZXlGcm9tUGVyaW9kJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAocGVyaW9kKSB7XG4gICAgICAgIGlmIChwZXJpb2QgPT09IDYpIHJldHVybiAnYXBwLmdyYXBocy5wZXJpb2QuNmgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAxMikgcmV0dXJuICdhcHAuZ3JhcGhzLnBlcmlvZC4xMmgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAyNCkgcmV0dXJuICdhcHAuZ3JhcGhzLnBlcmlvZC4yNGgnO1xuICAgICAgICBpZiAocGVyaW9kID09PSAyNCo3KSByZXR1cm4gJ2FwcC5ncmFwaHMucGVyaW9kLjdkJztcbiAgICAgICAgaWYgKHBlcmlvZCA9PT0gMjQqMzApIHJldHVybiAnYXBwLmdyYXBocy5wZXJpb2QuMzBkJztcblxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eURhdGUnLCBmdW5jdGlvbiAoJHRyYW5zbGF0ZSkge1xuICAgIC8vIGh0dHA6Ly9lam9obi5vcmcvZmlsZXMvcHJldHR5LmpzXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHByZXR0eURhdGUodXRjKSB7XG4gICAgICAgIHZhciBkYXRlID0gbmV3IERhdGUodXRjKSwgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgICAgICAgICBkaWZmID0gKCgobmV3IERhdGUoKSkuZ2V0VGltZSgpIC0gZGF0ZS5nZXRUaW1lKCkpIC8gMTAwMCkgKyAzMCwgLy8gYWRkIDMwc2Vjb25kcyBmb3IgY2xvY2sgc2tld1xuICAgICAgICAgICAgZGF5X2RpZmYgPSBNYXRoLmZsb29yKGRpZmYgLyA4NjQwMCk7XG5cbiAgICAgICAgaWYgKGlzTmFOKGRheV9kaWZmKSB8fCBkYXlfZGlmZiA8IDApIHJldHVybiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5qdXN0Tm93Jywge30pO1xuXG4gICAgICAgIHJldHVybiBkYXlfZGlmZiA9PT0gMCAmJiAoXG4gICAgICAgICAgICAgICAgZGlmZiA8IDYwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmp1c3ROb3cnLCB7fSkgfHxcbiAgICAgICAgICAgICAgICBkaWZmIDwgMTIwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLm1pbnV0ZXNBZ28nLCB7IG06IDEgfSkgfHxcbiAgICAgICAgICAgICAgICBkaWZmIDwgMzYwMCAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5taW51dGVzQWdvJywgeyBtOiBNYXRoLmZsb29yKCBkaWZmIC8gNjAgKSB9KSB8fFxuICAgICAgICAgICAgICAgIGRpZmYgPCA3MjAwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmhvdXJzQWdvJywgeyBoOiAxIH0pIHx8XG4gICAgICAgICAgICAgICAgZGlmZiA8IDg2NDAwICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmhvdXJzQWdvJywgeyBoOiBNYXRoLmZsb29yKCBkaWZmIC8gMzYwMCApIH0pXG4gICAgICAgICAgICApIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA9PT0gMSAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS55ZXNlcmRheScsIHt9KSB8fFxuICAgICAgICAgICAgZGF5X2RpZmYgPCA3ICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLmRheXNBZ28nLCB7IGQ6IGRheV9kaWZmIH0pIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA8IDMxICYmICR0cmFuc2xhdGUuaW5zdGFudCgnbWFpbi5wcmV0dHlEYXRlLndlZWtzQWdvJywgeyB3OiBNYXRoLmNlaWwoIGRheV9kaWZmIC8gNyApIH0pIHx8XG4gICAgICAgICAgICBkYXlfZGlmZiA8IDM2NSAmJiAkdHJhbnNsYXRlLmluc3RhbnQoJ21haW4ucHJldHR5RGF0ZS5tb250aHNBZ28nLCB7IG06IE1hdGgucm91bmQoIGRheV9kaWZmIC8gMzAgKSB9KSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJHRyYW5zbGF0ZS5pbnN0YW50KCdtYWluLnByZXR0eURhdGUueWVhcnNBZ28nLCB7IG06IE1hdGgucm91bmQoIGRheV9kaWZmIC8gMzY1ICkgfSk7XG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eUxvbmdEYXRlJywgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiBwcmV0dHlMb25nRGF0ZSh1dGMpIHtcbiAgICAgICAgcmV0dXJuIG1vbWVudCh1dGMpLmZvcm1hdCgnTU1NTSBEbyBZWVlZLCBoOm1tOnNzIGEnKTsgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ3ByZXR0eVNob3J0RGF0ZScsIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gcHJldHR5U2hvcnREYXRlKHV0Yykge1xuICAgICAgICByZXR1cm4gbW9tZW50KHV0YykuZm9ybWF0KCdNTU1NIERvIFlZWVknKTsgLy8gdGhpcyBjb252ZXJ0cyB1dGMgaW50byBicm93c2VyIHRpbWV6b25lIGFuZCBub3QgY2xvdWRyb24gdGltZXpvbmUhXG4gICAgfTtcbn0pO1xuXG5hbmd1bGFyLm1vZHVsZSgnQXBwbGljYXRpb24nKS5maWx0ZXIoJ21hcmtkb3duMmh0bWwnLCBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNvbnZlcnRlciA9IG5ldyBzaG93ZG93bi5Db252ZXJ0ZXIoe1xuICAgICAgICBzaW1wbGlmaWVkQXV0b0xpbms6IHRydWUsXG4gICAgICAgIHN0cmlrZXRocm91Z2g6IHRydWUsXG4gICAgICAgIHRhYmxlczogdHJ1ZSxcbiAgICAgICAgb3BlbkxpbmtzSW5OZXdXaW5kb3c6IHRydWVcbiAgICB9KTtcblxuICAgIC8vIHdpdGhvdXQgdGhpcyBjYWNoZSwgdGhlIGNvZGUgcnVucyBpbnRvIHNvbWUgaW5maW5pdGUgbG9vcCAoaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci5qcy9pc3N1ZXMvMzk4MClcbiAgICB2YXIgY2FjaGUgPSB7fTtcblxuICAgIHJldHVybiBmdW5jdGlvbiAodGV4dCkge1xuICAgICAgICBpZiAoY2FjaGVbdGV4dF0pIHJldHVybiBjYWNoZVt0ZXh0XTtcbiAgICAgICAgY2FjaGVbdGV4dF0gPSBjb252ZXJ0ZXIubWFrZUh0bWwodGV4dCk7XG4gICAgICAgIHJldHVybiBjYWNoZVt0ZXh0XTtcbiAgICB9O1xufSk7XG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmNvbmZpZyhbJyR0cmFuc2xhdGVQcm92aWRlcicsIGZ1bmN0aW9uICgkdHJhbnNsYXRlUHJvdmlkZXIpIHtcbiAgICAkdHJhbnNsYXRlUHJvdmlkZXIudXNlU3RhdGljRmlsZXNMb2FkZXIoe1xuICAgICAgICBwcmVmaXg6ICd0cmFuc2xhdGlvbi8nLFxuICAgICAgICBzdWZmaXg6ICcuanNvbj8nICsgJzMyZDk3ZjlmZmJhOWJhN2E5ODlkOGVmNTJiZTkxM2VmYjBkMjA5NDYnXG4gICAgfSk7XG4gICAgJHRyYW5zbGF0ZVByb3ZpZGVyLnVzZUxvY2FsU3RvcmFnZSgpO1xuICAgICR0cmFuc2xhdGVQcm92aWRlci5wcmVmZXJyZWRMYW5ndWFnZSgnZW4nKTtcbiAgICAkdHJhbnNsYXRlUHJvdmlkZXIuZmFsbGJhY2tMYW5ndWFnZSgnZW4nKTtcbn1dKTtcblxuLy8gQWRkIHNob3J0aGFuZCBcInRyXCIgZmlsdGVyIHRvIGF2b2lkIGhhdmluZyBvdCB1c2UgXCJ0cmFuc2xhdGVcIlxuLy8gVGhpcyBpcyBhIGNvcHkgb2YgdGhlIGNvZGUgYXQgaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXItdHJhbnNsYXRlL2FuZ3VsYXItdHJhbnNsYXRlL2Jsb2IvbWFzdGVyL3NyYy9maWx0ZXIvdHJhbnNsYXRlLmpzXG4vLyBJZiB3ZSBmaW5kIG91dCBob3cgdG8gZ2V0IHRoYXQgZnVuY3Rpb24gaGFuZGxlIHNvbWVob3cgZHluYW1pY2FsbHkgd2UgY2FuIHVzZSB0aGF0LCBvdGhlcndpc2UgdGhlIGNvcHkgaXMgcmVxdWlyZWRcbmZ1bmN0aW9uIHRyYW5zbGF0ZUZpbHRlckZhY3RvcnkoJHBhcnNlLCAkdHJhbnNsYXRlKSB7XG4gIHZhciB0cmFuc2xhdGVGaWx0ZXIgPSBmdW5jdGlvbiAodHJhbnNsYXRpb25JZCwgaW50ZXJwb2xhdGVQYXJhbXMsIGludGVycG9sYXRpb24sIGZvcmNlTGFuZ3VhZ2UpIHtcbiAgICBpZiAoIWFuZ3VsYXIuaXNPYmplY3QoaW50ZXJwb2xhdGVQYXJhbXMpKSB7XG4gICAgICB2YXIgY3R4ID0gdGhpcyB8fCB7XG4gICAgICAgICdfX1NDT1BFX0lTX05PVF9BVkFJTEFCTEUnOiAnTW9yZSBpbmZvIGF0IGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXIuanMvY29tbWl0Lzg4NjNiOWQwNGM3MjJiMjc4ZmE5M2M1ZDY2YWQxZTU3OGFkNmViMWYnXG4gICAgICAgIH07XG4gICAgICBpbnRlcnBvbGF0ZVBhcmFtcyA9ICRwYXJzZShpbnRlcnBvbGF0ZVBhcmFtcykoY3R4KTtcbiAgICB9XG5cbiAgICByZXR1cm4gJHRyYW5zbGF0ZS5pbnN0YW50KHRyYW5zbGF0aW9uSWQsIGludGVycG9sYXRlUGFyYW1zLCBpbnRlcnBvbGF0aW9uLCBmb3JjZUxhbmd1YWdlKTtcbiAgfTtcblxuICBpZiAoJHRyYW5zbGF0ZS5zdGF0ZWZ1bEZpbHRlcigpKSB7XG4gICAgdHJhbnNsYXRlRmlsdGVyLiRzdGF0ZWZ1bCA9IHRydWU7XG4gIH1cblxuICByZXR1cm4gdHJhbnNsYXRlRmlsdGVyO1xufVxudHJhbnNsYXRlRmlsdGVyRmFjdG9yeS5kaXNwbGF5TmFtZSA9ICd0cmFuc2xhdGVGaWx0ZXJGYWN0b3J5JztcbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmZpbHRlcigndHInLCB0cmFuc2xhdGVGaWx0ZXJGYWN0b3J5KTtcblxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDbG91ZHJvbiBSRVNUIEFQSSB3cmFwcGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLnNlcnZpY2UoJ0NsaWVudCcsIFsnJGh0dHAnLCAnJGludGVydmFsJywgJyR0aW1lb3V0JywgJ21kNScsICdOb3RpZmljYXRpb24nLCBmdW5jdGlvbiAoJGh0dHAsICRpbnRlcnZhbCwgJHRpbWVvdXQsIG1kNSwgTm90aWZpY2F0aW9uKSB7XG4gICAgdmFyIGNsaWVudCA9IG51bGw7XG5cbiAgICAvLyB2YXJpYWJsZSBhdmFpbGFibGUgb25seSBoZXJlIHRvIGF2b2lkIHRoaXMuX3Byb3BlcnR5IHBhdHRlcm5cbiAgICB2YXIgdG9rZW4gPSBudWxsO1xuXG4gICAgZnVuY3Rpb24gQ2xpZW50RXJyb3Ioc3RhdHVzQ29kZSwgbWVzc2FnZU9yT2JqZWN0KSB7XG4gICAgICAgIEVycm9yLmNhbGwodGhpcyk7XG4gICAgICAgIHRoaXMubmFtZSA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICAgICAgdGhpcy5zdGF0dXNDb2RlID0gc3RhdHVzQ29kZTtcbiAgICAgICAgaWYgKG1lc3NhZ2VPck9iamVjdCA9PT0gbnVsbCB8fCB0eXBlb2YgbWVzc2FnZU9yT2JqZWN0ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgdGhpcy5tZXNzYWdlID0gJ0VtcHR5IG1lc3NhZ2Ugb3Igb2JqZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgbWVzc2FnZU9yT2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZU9yT2JqZWN0O1xuICAgICAgICB9IGVsc2UgaWYgKG1lc3NhZ2VPck9iamVjdCkge1xuICAgICAgICAgICAgYW5ndWxhci5leHRlbmQodGhpcywgbWVzc2FnZU9yT2JqZWN0KTsgLy8gc3RhdHVzLCBtZXNzYWdlLCByZWFzb24gYW5kIG90aGVyIHByb3BlcnRpZXNcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spIHtcbiAgICAgICAgZnVuY3Rpb24gaGFuZGxlU2VydmVyT2ZmbGluZSgpIHtcbiAgICAgICAgICAgIGlmIChjbGllbnQub2ZmbGluZSkgcmV0dXJuO1xuXG4gICAgICAgICAgICAoZnVuY3Rpb24gb25saW5lQ2hlY2soKSB7XG4gICAgICAgICAgICAgICAgJGh0dHAuZ2V0KGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9jbG91ZHJvbi9zdGF0dXMnLCB7fSkuc3VjY2VzcyhmdW5jdGlvbiAoZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNsaWVudC5vZmZsaW5lID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGNsaWVudC5fcmVjb25uZWN0TGlzdGVuZXIuZm9yRWFjaChmdW5jdGlvbiAoaGFuZGxlcikgeyBoYW5kbGVyKCk7IH0pO1xuICAgICAgICAgICAgICAgIH0pLmVycm9yKGZ1bmN0aW9uIChkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY2xpZW50Lm9mZmxpbmUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAkdGltZW91dChvbmxpbmVDaGVjaywgNTAwMCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSByZXF1ZXN0IGtpbGxlZCBieSBicm93c2VyIChlZy4gY29ycyBpc3N1ZSlcbiAgICAgICAgICAgIGlmIChkYXRhID09PSBudWxsICYmIHN0YXR1cyA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVTZXJ2ZXJPZmZsaW5lKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcignUmVxdWVzdCBjYW5jZWxsZWQgYnkgYnJvd3NlcicpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gcmUtbG9naW4gd2lsbCBtYWtlIHRoZSBjb2RlIGdldCBhIG5ldyB0b2tlblxuICAgICAgICAgICAgaWYgKHN0YXR1cyA9PT0gNDAxKSByZXR1cm4gY2xpZW50LmxvZ2luKCk7XG5cbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09IDUwMCB8fCBzdGF0dXMgPT09IDUwMSkge1xuICAgICAgICAgICAgICAgIC8vIGFjdHVhbCBpbnRlcm5hbCBzZXJ2ZXIgZXJyb3IsIG1vc3QgbGlrZWx5IGEgYnVnIG9yIHRpbWVvdXQgbG9nIHRvIGNvbnNvbGUgb25seSB0byBub3QgYWxlcnQgdGhlIHVzZXJcbiAgICAgICAgICAgICAgICBpZiAoIWNsaWVudC5vZmZsaW5lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3Ioc3RhdHVzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJy0tLS0tLVxcbkNsb3Vkcm9uIEludGVybmFsIEVycm9yXFxuXFxuSWYgeW91IHNlZSB0aGlzLCBwbGVhc2Ugc2VuZCBhIG1haWwgd2l0aCBhYm92ZSBsb2cgdG8gc3VwcG9ydEBjbG91ZHJvbi5pb1xcbi0tLS0tLVxcbicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSA1MDIgfHwgc3RhdHVzID09PSA1MDMgfHwgc3RhdHVzID09PSA1MDQpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGlzIG1lYW5zIHRoZSBib3ggc2VydmljZSBpcyBub3QgcmVhY2hhYmxlLiBXZSBqdXN0IHNob3cgb2ZmbGluZSBiYW5uZXIgZm9yIG5vd1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoc3RhdHVzID49IDUwMikge1xuICAgICAgICAgICAgICAgIGhhbmRsZVNlcnZlck9mZmxpbmUoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgb2JqID0gZGF0YTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgb2JqID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIG9iaikpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlZmF1bHRTdWNjZXNzSGFuZGxlcihjYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIGRhdGEsIHN0YXR1cyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gWEhSIHdyYXBwZXIgdG8gc2V0IHRoZSBhdXRoIGhlYWRlclxuICAgIGZ1bmN0aW9uIGdldCh1cmwsIGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggIT09IDMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0dFVCcsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB0aHJvdygnV3JvbmcgbnVtYmVyIG9mIGFyZ3VtZW50cycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycyA9IGNvbmZpZy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cbiAgICAgICAgcmV0dXJuICRodHRwLmdldChjbGllbnQuYXBpT3JpZ2luICsgdXJsLCBjb25maWcpXG4gICAgICAgICAgICAuc3VjY2VzcyhkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoY2FsbGJhY2spKVxuICAgICAgICAgICAgLmVycm9yKGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoZWFkKHVybCwgY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCAhPT0gMykge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignSEVBRCcsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB0aHJvdygnV3JvbmcgbnVtYmVyIG9mIGFyZ3VtZW50cycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycyA9IGNvbmZpZy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cbiAgICAgICAgcmV0dXJuICRodHRwLmhlYWQoY2xpZW50LmFwaU9yaWdpbiArIHVybCwgY29uZmlnKVxuICAgICAgICAgICAgLnN1Y2Nlc3MoZGVmYXVsdFN1Y2Nlc3NIYW5kbGVyKGNhbGxiYWNrKSlcbiAgICAgICAgICAgIC5lcnJvcihkZWZhdWx0RXJyb3JIYW5kbGVyKGNhbGxiYWNrKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcG9zdCh1cmwsIGRhdGEsIGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggIT09IDQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1BPU1QnLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhyb3coJ1dyb25nIG51bWJlciBvZiBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHt9O1xuICAgICAgICBjb25maWcgPSBjb25maWcgfHwge307XG4gICAgICAgIGNvbmZpZy5oZWFkZXJzID0gY29uZmlnLmhlYWRlcnMgfHwge307XG4gICAgICAgIGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblxuICAgICAgICByZXR1cm4gJGh0dHAucG9zdChjbGllbnQuYXBpT3JpZ2luICsgdXJsLCBkYXRhLCBjb25maWcpXG4gICAgICAgICAgICAuc3VjY2VzcyhkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoY2FsbGJhY2spKVxuICAgICAgICAgICAgLmVycm9yKGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwdXQodXJsLCBkYXRhLCBjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSA0KSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdQVVQnLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhyb3coJ1dyb25nIG51bWJlciBvZiBhcmd1bWVudHMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRhdGEgPSBkYXRhIHx8IHt9O1xuICAgICAgICBjb25maWcgPSBjb25maWcgfHwge307XG4gICAgICAgIGNvbmZpZy5oZWFkZXJzID0gY29uZmlnLmhlYWRlcnMgfHwge307XG4gICAgICAgIGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblxuICAgICAgICByZXR1cm4gJGh0dHAucHV0KGNsaWVudC5hcGlPcmlnaW4gKyB1cmwsIGRhdGEsIGNvbmZpZylcbiAgICAgICAgICAgIC5zdWNjZXNzKGRlZmF1bHRTdWNjZXNzSGFuZGxlcihjYWxsYmFjaykpXG4gICAgICAgICAgICAuZXJyb3IoZGVmYXVsdEVycm9ySGFuZGxlcihjYWxsYmFjaykpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbCh1cmwsIGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggIT09IDMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0RFTCcsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB0aHJvdygnV3JvbmcgbnVtYmVyIG9mIGFyZ3VtZW50cycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycyA9IGNvbmZpZy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICBjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cbiAgICAgICAgcmV0dXJuICRodHRwLmRlbGV0ZShjbGllbnQuYXBpT3JpZ2luICsgdXJsLCBjb25maWcpXG4gICAgICAgICAgICAuc3VjY2VzcyhkZWZhdWx0U3VjY2Vzc0hhbmRsZXIoY2FsbGJhY2spKVxuICAgICAgICAgICAgLmVycm9yKGRlZmF1bHRFcnJvckhhbmRsZXIoY2FsbGJhY2spKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBDbGllbnQoKSB7XG4gICAgICAgIHRoaXMub2ZmbGluZSA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25maWdMaXN0ZW5lciA9IFtdO1xuICAgICAgICB0aGlzLl9yZWFkeUxpc3RlbmVyID0gW107XG4gICAgICAgIHRoaXMuX3JlY29ubmVjdExpc3RlbmVyID0gW107XG4gICAgICAgIHRoaXMuX3VzZXJJbmZvID0ge1xuICAgICAgICAgICAgaWQ6IG51bGwsXG4gICAgICAgICAgICB1c2VybmFtZTogbnVsbCxcbiAgICAgICAgICAgIGVtYWlsOiBudWxsLFxuICAgICAgICAgICAgdHdvRmFjdG9yQXV0aGVudGljYXRpb25FbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNvdXJjZTogbnVsbCxcbiAgICAgICAgICAgIGF2YXRhclVybDogbnVsbCxcbiAgICAgICAgICAgIGhhc0JhY2tncm91bmRJbWFnZTogZmFsc2VcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fY29uZmlnID0ge1xuICAgICAgICAgICAgY29uc29sZVNlcnZlck9yaWdpbjogbnVsbCxcbiAgICAgICAgICAgIGZxZG46IG51bGwsXG4gICAgICAgICAgICBpcDogbnVsbCxcbiAgICAgICAgICAgIHJldmlzaW9uOiBudWxsLFxuICAgICAgICAgICAgdXBkYXRlOiB7IGJveDogbnVsbCwgYXBwczogbnVsbCB9LFxuICAgICAgICAgICAgcHJvZ3Jlc3M6IHt9LFxuICAgICAgICAgICAgcmVnaW9uOiBudWxsLFxuICAgICAgICAgICAgc2l6ZTogbnVsbFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLl9pbnN0YWxsZWRBcHBzID0gW107XG4gICAgICAgIHRoaXMuX2luc3RhbGxlZEFwcHNCeUlkID0ge307XG4gICAgICAgIHRoaXMuX2FwcFRhZ3MgPSBbXTtcbiAgICAgICAgLy8gd2luZG93LmxvY2F0aW9uIGZhbGxiYWNrIGZvciB3ZWJzb2NrZXQgY29ubmVjdGlvbnMgd2hpY2ggZG8gbm90IGhhdmUgcmVsYXRpdmUgdXJpc1xuICAgICAgICB0aGlzLmFwaU9yaWdpbiA9ICcnIHx8IHdpbmRvdy5sb2NhdGlvbi5vcmlnaW47XG4gICAgICAgIHRoaXMuYXZhdGFyID0gJyc7XG4gICAgICAgIHRoaXMuX2F2YWlsYWJsZUxhbmd1YWdlcyA9IFsnZW4nXTtcbiAgICAgICAgdGhpcy5fYXBwc3RvcmVBcHBDYWNoZSA9IFtdO1xuXG4gICAgICAgIHRoaXMucmVzZXRBdmF0YXIoKTtcblxuICAgICAgICB0aGlzLnNldFRva2VuKGxvY2FsU3RvcmFnZS50b2tlbik7XG4gICAgfVxuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5lcnJvciA9IGZ1bmN0aW9uIChlcnJvciwgYWN0aW9uKSB7XG4gICAgICAgIHZhciBtZXNzYWdlID0gJyc7XG5cbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBlcnJvciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8IGVycm9yO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbWVzc2FnZSA9IGVycm9yO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZ2l2ZSBtb3JlIGluZm8gaW4gY2FzZSB0aGUgZXJyb3Igd2FzIGEgcmVxdWVzdCB3aGljaCBmYWlsZWQgd2l0aCBlbXB0eSByZXNwb25zZSBib2R5LFxuICAgICAgICAvLyB0aGlzIGhhcHBlbnMgbW9zdGx5IGlmIHRoZSBib3ggY3Jhc2hlc1xuICAgICAgICBpZiAobWVzc2FnZSA9PT0gJ0VtcHR5IG1lc3NhZ2Ugb3Igb2JqZWN0Jykge1xuICAgICAgICAgICAgbWVzc2FnZSA9ICdHb3QgZW1wdHkgcmVzcG9uc2UuIENsaWNrIHRvIGNoZWNrIHRoZSBzZXJ2ZXIgbG9ncy4nO1xuICAgICAgICAgICAgYWN0aW9uID0gYWN0aW9uIHx8ICcvbG9ncy5odG1sP2lkPWJveCc7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm5vdGlmeSgnQ2xvdWRyb24gRXJyb3InLCBtZXNzYWdlLCB0cnVlLCAnZXJyb3InLCBhY3Rpb24pO1xuICAgIH07XG5cbiAgICAvLyBoYW5kbGVzIGFwcGxpY2F0aW9uIHN0YXJ0dXAgZXJyb3JzLCBtb3N0bHkgb25seSB3aGVuIGRhc2hib2FyZCBpcyBsb2FkZWQgYW5kIGFwaSBlbmRwb2ludCBpcyBkb3duXG4gICAgQ2xpZW50LnByb3RvdHlwZS5pbml0RXJyb3IgPSBmdW5jdGlvbiAoZXJyb3IsIGluaXRGdW5jdGlvbikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdBcHBsaWNhdGlvbiBzdGFydHVwIGVycm9yJywgZXJyb3IpO1xuXG4gICAgICAgICR0aW1lb3V0KGluaXRGdW5jdGlvbiwgNTAwMCk7IC8vIHdlIHdpbGwgdHJ5IHRvIHJlLWluaXQgdGhlIGFwcFxuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNsZWFyTm90aWZpY2F0aW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgTm90aWZpY2F0aW9uLmNsZWFyQWxsKCk7XG4gICAgfTtcblxuICAgIC8qXG5cbiAgICBJZiBgYWN0aW9uYCBpcyBhIG5vbi1lbXB0eSBzdHJpbmcsIGl0IHdpbGwgYmUgdHJlYXRlZCBhcyBhIHVybCwgaWYgaXQgaXMgYSBmdW5jdGlvbiwgdGhhdCBmdW5jdGlvbiB3aWxsIGJlIGV4ZWN0dWVkIG9uIGNsaWNrXG5cbiAgICAqL1xuICAgIENsaWVudC5wcm90b3R5cGUubm90aWZ5ID0gZnVuY3Rpb24gKHRpdGxlLCBtZXNzYWdlLCBwZXJzaXN0ZW50LCB0eXBlLCBhY3Rpb24pIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7IHRpdGxlOiB0aXRsZSwgbWVzc2FnZTogbWVzc2FnZX07XG5cbiAgICAgICAgaWYgKHBlcnNpc3RlbnQpIG9wdGlvbnMuZGVsYXkgPSAnbmV2ZXInOyAvLyBhbnkgbm9uIE51bWJlciBtZWFucyBuZXZlciB0aW1lb3V0XG5cbiAgICAgICAgaWYgKGFjdGlvbikge1xuICAgICAgICAgICAgb3B0aW9ucy5vbkNsaWNrID0gZnVuY3Rpb24gKC8qIHBhcmFtcyAqLykge1xuICAgICAgICAgICAgICAgIC8vIGlmIGFjdGlvbiBpcyBhIHN0cmluZywgd2UgYXNzdW1lIGl0IGlzIGEgbGlua1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgYWN0aW9uID09PSAnc3RyaW5nJyAmJiBhY3Rpb24gIT09ICcnKSB3aW5kb3cubG9jYXRpb24gPSBhY3Rpb247XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAodHlwZW9mIGFjdGlvbiA9PT0gJ2Z1bmN0aW9uJykgYWN0aW9uKCk7XG4gICAgICAgICAgICAgICAgZWxzZSBjb25zb2xlLndhcm4oJ05vdGlmaWNhdGlvbiBhY3Rpb24gaXMgbm90IHN1cHBvcnRlZC4nLCBhY3Rpb24pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlID09PSAnZXJyb3InKSBOb3RpZmljYXRpb24uZXJyb3Iob3B0aW9ucyk7XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT09ICdzdWNjZXNzJykgTm90aWZpY2F0aW9uLnN1Y2Nlc3Mob3B0aW9ucyk7XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT09ICdpbmZvJykgTm90aWZpY2F0aW9uLmluZm8ob3B0aW9ucyk7XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT09ICd3YXJuaW5nJykgTm90aWZpY2F0aW9uLndhcm5pbmcob3B0aW9ucyk7XG4gICAgICAgIGVsc2UgdGhyb3coJ0ludmFsaWQgbm90aWZpY2F0aW9uIHR5cGUgXCInICsgdHlwZSArICdcIicpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFJlYWR5ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5fcmVhZHkpIHJldHVybjtcblxuICAgICAgICB0aGlzLl9yZWFkeSA9IHRydWU7XG4gICAgICAgIHRoaXMuX3JlYWR5TGlzdGVuZXIuZm9yRWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIGNsZWFyIHRoZSBsaXN0ZW5lcnMsIHdlIG9ubHkgY2FsbGJhY2sgb25jZSFcbiAgICAgICAgdGhpcy5fcmVhZHlMaXN0ZW5lciA9IFtdO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLm9uUmVhZHkgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKHRoaXMuX3JlYWR5KSBjYWxsYmFjaygpO1xuICAgICAgICBlbHNlIHRoaXMuX3JlYWR5TGlzdGVuZXIucHVzaChjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUub25Db25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5fY29uZmlnTGlzdGVuZXIucHVzaChjYWxsYmFjayk7XG4gICAgICAgIGlmICh0aGlzLl9jb25maWcpIGNhbGxiYWNrKHRoaXMuX2NvbmZpZyk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUub25SZWNvbm5lY3QgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKHRoaXMuX3JlYWR5KSBjYWxsYmFjaygpO1xuICAgICAgICBlbHNlIHRoaXMuX3JlY29ubmVjdExpc3RlbmVyLnB1c2goY2FsbGJhY2spO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlc2V0QXZhdGFyID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmF2YXRhciA9IHRoaXMuYXBpT3JpZ2luICsgJy9hcGkvdjEvY2xvdWRyb24vYXZhdGFyPycgKyBTdHJpbmcoTWF0aC5yYW5kb20oKSkuc2xpY2UoMik7XG5cbiAgICAgICAgdmFyIGZhdmljb24gPSAkKCcjZmF2aWNvbicpO1xuICAgICAgICBpZiAoZmF2aWNvbikgZmF2aWNvbi5hdHRyKCdocmVmJywgdGhpcy5hdmF0YXIpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFVzZXJJbmZvID0gZnVuY3Rpb24gKHVzZXJJbmZvKSB7XG4gICAgICAgIC8vIEluIG9yZGVyIHRvIGtlZXAgdGhlIGFuZ3VsYXIgYmluZGluZ3MgYWxpdmUsIHNldCBlYWNoIHByb3BlcnR5IGluZGl2aWR1YWxseVxuICAgICAgICB0aGlzLl91c2VySW5mby5pZCA9IHVzZXJJbmZvLmlkO1xuICAgICAgICB0aGlzLl91c2VySW5mby51c2VybmFtZSA9IHVzZXJJbmZvLnVzZXJuYW1lO1xuICAgICAgICB0aGlzLl91c2VySW5mby5lbWFpbCA9IHVzZXJJbmZvLmVtYWlsO1xuICAgICAgICB0aGlzLl91c2VySW5mby5mYWxsYmFja0VtYWlsID0gdXNlckluZm8uZmFsbGJhY2tFbWFpbDtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uZGlzcGxheU5hbWUgPSB1c2VySW5mby5kaXNwbGF5TmFtZTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8udHdvRmFjdG9yQXV0aGVudGljYXRpb25FbmFibGVkID0gdXNlckluZm8udHdvRmFjdG9yQXV0aGVudGljYXRpb25FbmFibGVkO1xuICAgICAgICB0aGlzLl91c2VySW5mby5yb2xlID0gdXNlckluZm8ucm9sZTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uc291cmNlID0gdXNlckluZm8uc291cmNlO1xuICAgICAgICB0aGlzLl91c2VySW5mby5hdmF0YXJVcmwgPSB1c2VySW5mby5hdmF0YXJVcmwgKyAnP3M9MTI4JmRlZmF1bHQ9bXAmdHM9JyArIERhdGUubm93KCk7IC8vIHdlIGFkZCB0aGUgdGltZXN0YW1wIHRvIGF2b2lkIGNhY2hpbmdcbiAgICAgICAgdGhpcy5fdXNlckluZm8uaGFzQmFja2dyb3VuZEltYWdlID0gdXNlckluZm8uaGFzQmFja2dyb3VuZEltYWdlO1xuICAgICAgICB0aGlzLl91c2VySW5mby5pc0F0TGVhc3RPd25lciA9IFsgUk9MRVMuT1dORVIgXS5pbmRleE9mKHVzZXJJbmZvLnJvbGUpICE9PSAtMTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uaXNBdExlYXN0QWRtaW4gPSBbIFJPTEVTLk9XTkVSLCBST0xFUy5BRE1JTiBdLmluZGV4T2YodXNlckluZm8ucm9sZSkgIT09IC0xO1xuICAgICAgICB0aGlzLl91c2VySW5mby5pc0F0TGVhc3RNYWlsTWFuYWdlciA9IFsgUk9MRVMuT1dORVIsIFJPTEVTLkFETUlOLCBST0xFUy5NQUlMX01BTkFHRVIgXS5pbmRleE9mKHVzZXJJbmZvLnJvbGUpICE9PSAtMTtcbiAgICAgICAgdGhpcy5fdXNlckluZm8uaXNBdExlYXN0VXNlck1hbmFnZXIgPSBbIFJPTEVTLk9XTkVSLCBST0xFUy5BRE1JTiwgUk9MRVMuTUFJTF9NQU5BR0VSLCBST0xFUy5VU0VSX01BTkFHRVIgXS5pbmRleE9mKHVzZXJJbmZvLnJvbGUpICE9PSAtMTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRDb25maWcgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBhbmd1bGFyLmNvcHkoY29uZmlnLCB0aGlzLl9jb25maWcpO1xuXG5cbiAgICAgICAgLy8gPT4gVGhpcyBpcyBqdXN0IGZvciBlYXNpZXIgdGVzdGluZ1xuICAgICAgICAvLyB0aGlzLl9jb25maWcuZmVhdHVyZXMuZXh0ZXJuYWxMZGFwID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5fY29uZmlnTGlzdGVuZXIuZm9yRWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHRoYXQuX2NvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEluc3RhbGxlZEFwcHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9pbnN0YWxsZWRBcHBzO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcFRhZ3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hcHBUYWdzO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVzZXJJbmZvID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fdXNlckluZm87XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Q29uZmlnID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fY29uZmlnO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEF2YWlsYWJsZUxhbmd1YWdlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2F2YWlsYWJsZUxhbmd1YWdlcztcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUb2tlbiA9IGZ1bmN0aW9uIChhY2Nlc3NUb2tlbikge1xuICAgICAgICBpZiAoIWFjY2Vzc1Rva2VuKSBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgndG9rZW4nKTtcbiAgICAgICAgZWxzZSBsb2NhbFN0b3JhZ2UudG9rZW4gPSBhY2Nlc3NUb2tlbjtcblxuICAgICAgICAvLyBzZXQgdGhlIHRva2VuIGNsb3N1cmVcbiAgICAgICAgdG9rZW4gPSBhY2Nlc3NUb2tlbjtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRUb2tlbiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLm1ha2VVUkwgPSBmdW5jdGlvbiAodXJsKSB7XG4gICAgICAgIGlmICh1cmwuaW5kZXhPZignPycpID09PSAtMSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXBpT3JpZ2luICsgdXJsICsgJz9hY2Nlc3NfdG9rZW49JyArIHRva2VuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXBpT3JpZ2luICsgdXJsICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIC8qXG4gICAgICogUmVzdCBBUEkgd3JhcHBlcnNcbiAgICAgKi9cbiAgICBDbGllbnQucHJvdG90eXBlLmNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCB8fCB0eXBlb2YgZGF0YSAhPT0gJ29iamVjdCcpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXNlckluZm8gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3Byb2ZpbGUnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwIHx8IHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JykgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGFuZ2VDbG91ZHJvbkF2YXRhciA9IGZ1bmN0aW9uIChhdmF0YXJGaWxlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZmQgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgZmQuYXBwZW5kKCdhdmF0YXInLCBhdmF0YXJGaWxlKTtcblxuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogdW5kZWZpbmVkIH0sXG4gICAgICAgICAgICB0cmFuc2Zvcm1SZXF1ZXN0OiBhbmd1bGFyLmlkZW50aXR5XG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9icmFuZGluZy9jbG91ZHJvbl9hdmF0YXInLCBmZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNoYW5nZUNsb3Vkcm9uTmFtZSA9IGZ1bmN0aW9uIChuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2JyYW5kaW5nL2Nsb3Vkcm9uX25hbWUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmluc3RhbGxBcHAgPSBmdW5jdGlvbiAoaWQsIG1hbmlmZXN0LCB0aXRsZSwgY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYXBwU3RvcmVJZDogaWQgKyAnQCcgKyBtYW5pZmVzdC52ZXJzaW9uLFxuICAgICAgICAgICAgc3ViZG9tYWluOiBjb25maWcuc3ViZG9tYWluLFxuICAgICAgICAgICAgZG9tYWluOiBjb25maWcuZG9tYWluLFxuICAgICAgICAgICAgc2Vjb25kYXJ5RG9tYWluczogY29uZmlnLnNlY29uZGFyeURvbWFpbnMsXG4gICAgICAgICAgICBwb3J0QmluZGluZ3M6IGNvbmZpZy5wb3J0QmluZGluZ3MsXG4gICAgICAgICAgICBhY2Nlc3NSZXN0cmljdGlvbjogY29uZmlnLmFjY2Vzc1Jlc3RyaWN0aW9uLFxuICAgICAgICAgICAgY2VydDogY29uZmlnLmNlcnQsXG4gICAgICAgICAgICBrZXk6IGNvbmZpZy5rZXksXG4gICAgICAgICAgICBzc286IGNvbmZpZy5zc28sXG4gICAgICAgICAgICBvdmVyd3JpdGVEbnM6IGNvbmZpZy5vdmVyd3JpdGVEbnNcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvaW5zdGFsbCcsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuaWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jbG9uZUFwcCA9IGZ1bmN0aW9uIChhcHBJZCwgY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIHN1YmRvbWFpbjogY29uZmlnLnN1YmRvbWFpbixcbiAgICAgICAgICAgIGRvbWFpbjogY29uZmlnLmRvbWFpbixcbiAgICAgICAgICAgIHNlY29uZGFyeURvbWFpbnM6IGNvbmZpZy5zZWNvbmRhcnlEb21haW5zLFxuICAgICAgICAgICAgcG9ydEJpbmRpbmdzOiBjb25maWcucG9ydEJpbmRpbmdzLFxuICAgICAgICAgICAgYmFja3VwSWQ6IGNvbmZpZy5iYWNrdXBJZCxcbiAgICAgICAgICAgIG92ZXJ3cml0ZURuczogISFjb25maWcub3ZlcndyaXRlRG5zXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvY2xvbmUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVzdG9yZUFwcCA9IGZ1bmN0aW9uIChhcHBJZCwgYmFja3VwSWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0geyBiYWNrdXBJZDogYmFja3VwSWQgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9yZXN0b3JlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmJhY2t1cEFwcCA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7fTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9iYWNrdXAnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudW5pbnN0YWxsQXBwID0gZnVuY3Rpb24gKGFwcElkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHt9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL3VuaW5zdGFsbCcsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jb25maWd1cmVBcHAgPSBmdW5jdGlvbiAoaWQsIHNldHRpbmcsIGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL2NvbmZpZ3VyZS8nICsgc2V0dGluZywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCAmJiBzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlcGFpckFwcCA9IGZ1bmN0aW9uIChpZCwgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBpZCArICcvcmVwYWlyJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCAmJiBzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmVkaXRBcHBCYWNrdXAgPSBmdW5jdGlvbiAoaWQsIGJhY2t1cElkLCBsYWJlbCwgcHJlc2VydmVTZWNzLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGlkICsgJy9iYWNrdXBzLycgKyBiYWNrdXBJZCwgeyBsYWJlbDogbGFiZWwsIHByZXNlcnZlU2VjczogcHJlc2VydmVTZWNzIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVBcHAgPSBmdW5jdGlvbiAoaWQsIG1hbmlmZXN0LCBvcHRpb25zLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9ICB7XG4gICAgICAgICAgICBhcHBTdG9yZUlkOiBtYW5pZmVzdC5pZCArICdAJyArIG1hbmlmZXN0LnZlcnNpb24sXG4gICAgICAgICAgICBza2lwQmFja3VwOiAhIW9wdGlvbnMuc2tpcEJhY2t1cFxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL3VwZGF0ZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zdGFydEFwcCA9IGZ1bmN0aW9uIChpZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBpZCArICcvc3RhcnQnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnN0b3BBcHAgPSBmdW5jdGlvbiAoaWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL3N0b3AnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlc3RhcnRBcHAgPSBmdW5jdGlvbiAoaWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwcy8nICsgaWQgKyAnL3Jlc3RhcnQnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmRlYnVnQXBwID0gZnVuY3Rpb24gKGlkLCBzdGF0ZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBkZWJ1Z01vZGU6IHN0YXRlID8ge1xuICAgICAgICAgICAgICAgIHJlYWRvbmx5Um9vdGZzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBjbWQ6IFsgJy9iaW4vYmFzaCcsICctYycsICdlY2hvIFwiUmVwYWlyIG1vZGUuIFVzZSB0aGUgd2VidGVybWluYWwgb3IgY2xvdWRyb24gZXhlYyB0byByZXBhaXIuIFNsZWVwaW5nXCIgJiYgc2xlZXAgaW5maW5pdHknIF1cbiAgICAgICAgICAgIH0gOiBudWxsXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBpZCArICcvY29uZmlndXJlL2RlYnVnX21vZGUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY3JlYXRlRXhlYyA9IGZ1bmN0aW9uIChpZCwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBpZCArICcvZXhlYycsIG9wdGlvbnMsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuaWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS52ZXJzaW9uID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9zdGF0dXMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFN0YXR1cyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvY2xvdWRyb24vc3RhdHVzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCB8fCB0eXBlb2YgZGF0YSAhPT0gJ29iamVjdCcpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0QmFja3VwQ29uZmlnID0gZnVuY3Rpb24gKGJhY2t1cENvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9iYWNrdXBfY29uZmlnJywgYmFja3VwQ29uZmlnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QmFja3VwQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9iYWNrdXBfY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlbW91bnRCYWNrdXBTdG9yYWdlID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYmFja3Vwcy9yZW1vdW50Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTdXBwb3J0Q29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9zdXBwb3J0X2NvbmZpZycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRFeHRlcm5hbExkYXBDb25maWcgPSBmdW5jdGlvbiAoY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL2V4dGVybmFsX2xkYXBfY29uZmlnJywgY29uZmlnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0RXh0ZXJuYWxMZGFwQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9leHRlcm5hbF9sZGFwX2NvbmZpZycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRQcm9maWxlQ29uZmlnID0gZnVuY3Rpb24gKGNvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9wcm9maWxlX2NvbmZpZycsIGNvbmZpZywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFByb2ZpbGVDb25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL3Byb2ZpbGVfY29uZmlnJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFVzZXJEaXJlY3RvcnlDb25maWcgPSBmdW5jdGlvbiAoY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL3VzZXJfZGlyZWN0b3J5X2NvbmZpZycsIGNvbmZpZywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVzZXJEaXJlY3RvcnlDb25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL3VzZXJfZGlyZWN0b3J5X2NvbmZpZycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLy8gbmV0d29ya1xuICAgIENsaWVudC5wcm90b3R5cGUuc2V0U3lzaW5mb0NvbmZpZyA9IGZ1bmN0aW9uIChjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvc2V0dGluZ3Mvc3lzaW5mb19jb25maWcnLCBjb25maWcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTeXNpbmZvQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9zeXNpbmZvX2NvbmZpZycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2ZXJJcHY0ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9zZXJ2ZXJfaXB2NCcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2ZXJJcHY2ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9zZXJ2ZXJfaXB2NicsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRCbG9ja2xpc3QgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHt9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9uZXR3b3JrL2Jsb2NrbGlzdCcsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuYmxvY2tsaXN0KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0QmxvY2tsaXN0ID0gZnVuY3Rpb24gKGJsb2NrbGlzdCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9uZXR3b3JrL2Jsb2NrbGlzdCcsIHsgYmxvY2tsaXN0OiBibG9ja2xpc3QgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldER5bmFtaWNEbnNDb25maWcgPSBmdW5jdGlvbiAoZW5hYmxlZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9keW5hbWljX2RucycsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldER5bmFtaWNEbnNDb25maWcgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL2R5bmFtaWNfZG5zJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5lbmFibGVkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0SVB2NkNvbmZpZyA9IGZ1bmN0aW9uIChjb25maWcsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvc2V0dGluZ3MvaXB2Nl9jb25maWcnLCBjb25maWcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0SVB2NkNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvaXB2Nl9jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIGJyYW5kaW5nXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRGb290ZXIgPSBmdW5jdGlvbiAoZm9vdGVyLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2JyYW5kaW5nL2Zvb3RlcicsIHsgZm9vdGVyOiBmb290ZXIgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEZvb3RlciA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvYnJhbmRpbmcvZm9vdGVyJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5mb290ZXIpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRVbnN0YWJsZUFwcHNDb25maWcgPSBmdW5jdGlvbiAoZW5hYmxlZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy91bnN0YWJsZV9hcHBzJywgeyBlbmFibGVkOiBlbmFibGVkIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0VW5zdGFibGVBcHBzQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy91bnN0YWJsZV9hcHBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFJlZ2lzdHJ5Q29uZmlnID0gZnVuY3Rpb24gKHJjLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL3JlZ2lzdHJ5X2NvbmZpZycsIHJjLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFJlZ2lzdHJ5Q29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9zZXR0aW5ncy9yZWdpc3RyeV9jb25maWcnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFVwZGF0ZUluZm8gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKCF0aGlzLl91c2VySW5mby5pc0F0TGVhc3RBZG1pbikgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcignTm90IGFsbG93ZWQnKSk7XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL3VwZGF0ZScsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGVja0ZvclVwZGF0ZXMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9jbG91ZHJvbi9jaGVja19mb3JfdXBkYXRlcycsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjbGllbnQucmVmcmVzaENvbmZpZyhjYWxsYmFjayk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNoZWNrRm9yQXBwVXBkYXRlcyA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvY2hlY2tfZm9yX3VwZGF0ZXMnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2xpZW50LnJlZnJlc2hDb25maWcoY2FsbGJhY2spO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRBdXRvdXBkYXRlUGF0dGVybiA9IGZ1bmN0aW9uIChwYXR0ZXJuLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NldHRpbmdzL2F1dG91cGRhdGVfcGF0dGVybicsIHsgcGF0dGVybjogcGF0dGVybiB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXV0b3VwZGF0ZVBhdHRlcm4gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL2F1dG91cGRhdGVfcGF0dGVybicsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUaW1lWm9uZSA9IGZ1bmN0aW9uICh0aW1lWm9uZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy90aW1lX3pvbmUnLCB7IHRpbWVab25lOiB0aW1lWm9uZSB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0VGltZVpvbmUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NldHRpbmdzL3RpbWVfem9uZScsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGltZVpvbmUpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRMYW5ndWFnZSA9IGZ1bmN0aW9uIChsYW5ndWFnZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9sYW5ndWFnZScsIHsgbGFuZ3VhZ2U6IGxhbmd1YWdlIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRMYW5ndWFnZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2V0dGluZ3MvbGFuZ3VhZ2UnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxhbmd1YWdlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0UmVtb3RlU3VwcG9ydCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc3VwcG9ydC9yZW1vdGVfc3VwcG9ydCcsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmVuYWJsZVJlbW90ZVN1cHBvcnQgPSBmdW5jdGlvbiAoZW5hYmxlLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3N1cHBvcnQvcmVtb3RlX3N1cHBvcnQnLCB7IGVuYWJsZTogZW5hYmxlIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRCYWNrdXBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9iYWNrdXBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5iYWNrdXBzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TGF0ZXN0VGFza0J5VHlwZSA9IGZ1bmN0aW9uICh0eXBlLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdGFza3M/cGFnZT0xJnBlcl9wYWdlPTEmdHlwZT0nICsgdHlwZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrcy5sZW5ndGggPyBkYXRhLnRhc2tzWzBdIDogbnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFRhc2sgPSBmdW5jdGlvbiAodGFza0lkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdGFza3MvJyArIHRhc2tJZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFRhc2tMb2dzID0gZnVuY3Rpb24gKHRhc2tJZCwgZm9sbG93LCBsaW5lcywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGZvbGxvdykge1xuICAgICAgICAgICAgdmFyIGV2ZW50U291cmNlID0gbmV3IEV2ZW50U291cmNlKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS90YXNrcy8nICsgdGFza0lkICsgJy9sb2dzdHJlYW0/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgdGFza0lkICsgJy9sb2dzP2xpbmVzPScgKyBsaW5lcywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmVkaXRCYWNrdXAgPSBmdW5jdGlvbiAoYmFja3VwSWQsIGxhYmVsLCBwcmVzZXJ2ZVNlY3MsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYmFja3Vwcy8nICsgYmFja3VwSWQsIHsgbGFiZWw6IGxhYmVsLCBwcmVzZXJ2ZVNlY3M6IHByZXNlcnZlU2VjcyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc3RhcnRCYWNrdXAgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9iYWNrdXBzL2NyZWF0ZScsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRhc2tJZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNsZWFudXBCYWNrdXBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYmFja3Vwcy9jbGVhbnVwJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGFza0lkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc3RvcFRhc2sgPSBmdW5jdGlvbiAodGFza0lkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3Rhc2tzLycgKyB0YXNrSWQgKyAnL3N0b3AnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlc3RvcmUgPSBmdW5jdGlvbiAoYmFja3VwQ29uZmlnLCByZW1vdGVQYXRoLCB2ZXJzaW9uLCBzeXNpbmZvQ29uZmlnLCBza2lwRG5zU2V0dXAsIHNldHVwVG9rZW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYmFja3VwQ29uZmlnOiBiYWNrdXBDb25maWcsXG4gICAgICAgICAgICByZW1vdGVQYXRoOiByZW1vdGVQYXRoLFxuICAgICAgICAgICAgdmVyc2lvbjogdmVyc2lvbixcbiAgICAgICAgICAgIHN5c2luZm9Db25maWc6IHN5c2luZm9Db25maWcsXG4gICAgICAgICAgICBza2lwRG5zU2V0dXA6IHNraXBEbnNTZXR1cCxcbiAgICAgICAgICAgIHNldHVwVG9rZW46IHNldHVwVG9rZW5cbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3Jlc3RvcmUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cykpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuaW1wb3J0QmFja3VwID0gZnVuY3Rpb24gKGFwcElkLCByZW1vdGVQYXRoLCBiYWNrdXBGb3JtYXQsIGJhY2t1cENvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICByZW1vdGVQYXRoOiByZW1vdGVQYXRoLFxuICAgICAgICAgICAgYmFja3VwRm9ybWF0OiBiYWNrdXBGb3JtYXQsXG4gICAgICAgICAgICBiYWNrdXBDb25maWc6IGJhY2t1cENvbmZpZyxcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9pbXBvcnQnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cykpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Tm90aWZpY2F0aW9ucyA9IGZ1bmN0aW9uIChvcHRpb25zLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5hY2tub3dsZWRnZWQgPT09ICdib29sZWFuJykgY29uZmlnLnBhcmFtcy5hY2tub3dsZWRnZWQgPSBvcHRpb25zLmFja25vd2xlZGdlZDtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbm90aWZpY2F0aW9ucycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5ub3RpZmljYXRpb25zKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYWNrTm90aWZpY2F0aW9uID0gZnVuY3Rpb24gKG5vdGlmaWNhdGlvbklkLCBhY2tub3dsZWRnZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbm90aWZpY2F0aW9ucy8nICsgbm90aWZpY2F0aW9uSWQsIHsgYWNrbm93bGVkZ2VkOiBhY2tub3dsZWRnZWQgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEV2ZW50ID0gZnVuY3Rpb24gKGV2ZW50SWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9ldmVudGxvZy8nICsgZXZlbnRJZCwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRFdmVudExvZ3MgPSBmdW5jdGlvbiAoYWN0aW9ucywgc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogYWN0aW9ucyxcbiAgICAgICAgICAgICAgICBzZWFyY2g6IHNlYXJjaCxcbiAgICAgICAgICAgICAgICBwYWdlOiBwYWdlLFxuICAgICAgICAgICAgICAgIHBlcl9wYWdlOiBwZXJQYWdlXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL2V2ZW50bG9nJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmV2ZW50bG9ncyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFBsYXRmb3JtTG9ncyA9IGZ1bmN0aW9uICh1bml0LCBmb2xsb3csIGxpbmVzLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoZm9sbG93KSB7XG4gICAgICAgICAgICB2YXIgZXZlbnRTb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UoY2xpZW50LmFwaU9yaWdpbiArICcvYXBpL3YxL2Nsb3Vkcm9uL2xvZ3N0cmVhbS8nICsgdW5pdCArICc/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9sb2dzLycgKyB1bml0ICsgJz9saW5lcz0nICsgbGluZXMsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2aWNlTG9ncyA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgZm9sbG93LCBsaW5lcywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKGZvbGxvdykge1xuICAgICAgICAgICAgdmFyIGV2ZW50U291cmNlID0gbmV3IEV2ZW50U291cmNlKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUgKyAnL2xvZ3N0cmVhbT9saW5lcz0nICsgbGluZXMgKyAnJmFjY2Vzc190b2tlbj0nICsgdG9rZW4pO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZXZlbnRTb3VyY2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZ2V0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSArICcvbG9ncz9saW5lcz0nICsgbGluZXMsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIHZhciBhcHBzID0gZGF0YS5hcHBzO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcHBzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhhdC5fYXBwUG9zdFByb2Nlc3MoYXBwc1tpXSk7IC8vIHRoaXMgd2lsbCBhbHNvIHNldCB0aGUgY29ycmVjdCBpY29uVXJsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGFwcHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBMb2dzID0gZnVuY3Rpb24gKGFwcElkLCBmb2xsb3csIGxpbmVzLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAoZm9sbG93KSB7XG4gICAgICAgICAgICB2YXIgZXZlbnRTb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UoY2xpZW50LmFwaU9yaWdpbiArICcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9sb2dzdHJlYW0/bGluZXM9JyArIGxpbmVzICsgJyZhY2Nlc3NfdG9rZW49JyArIHRva2VuKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGV2ZW50U291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGdldCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvbG9ncycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBCYWNrdXBzID0gZnVuY3Rpb24gKGFwcElkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL2JhY2t1cHMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmJhY2t1cHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTZXJ2aWNlcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvc2VydmljZXMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnNlcnZpY2VzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5zZXJ2aWNlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY29uZmlndXJlU2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZXN0YXJ0U2VydmljZSA9IGZ1bmN0aW9uIChzZXJ2aWNlTmFtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXJ2aWNlcy8nICsgc2VydmljZU5hbWUgKyAnL3Jlc3RhcnQnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlYnVpbGRTZXJ2aWNlID0gZnVuY3Rpb24gKHNlcnZpY2VOYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3NlcnZpY2VzLycgKyBzZXJ2aWNlTmFtZSArICcvcmVidWlsZCcsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QWxsVXNlcnMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHBhZ2UgPSAxO1xuICAgICAgICB2YXIgcGVyUGFnZSA9IDUwMDA7XG4gICAgICAgIHZhciB1c2VycyA9IFtdO1xuXG4gICAgICAgIGZ1bmN0aW9uIGZldGNoTW9yZSgpIHtcbiAgICAgICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIHBhZ2U6IHBhZ2UsXG4gICAgICAgICAgICAgICAgICAgIHBlcl9wYWdlOiBwZXJQYWdlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZ2V0KCcvYXBpL3YxL3VzZXJzJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgICAgICB1c2VycyA9IHVzZXJzLmNvbmNhdChkYXRhLnVzZXJzKTtcblxuICAgICAgICAgICAgICAgIGlmIChkYXRhLnVzZXJzLmxlbmd0aCA8IHBlclBhZ2UpIHJldHVybiBjYWxsYmFjayhudWxsLCB1c2Vycyk7XG5cbiAgICAgICAgICAgICAgICBwYWdlKys7XG5cbiAgICAgICAgICAgICAgICBmZXRjaE1vcmUoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZmV0Y2hNb3JlKCk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0VXNlcnMgPSBmdW5jdGlvbiAoc2VhcmNoLCBhY3RpdmUsIHBhZ2UsIHBlclBhZ2UsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICBwYWdlOiBwYWdlLFxuICAgICAgICAgICAgICAgIHBlcl9wYWdlOiBwZXJQYWdlXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHNlYXJjaCkgY29uZmlnLnBhcmFtcy5zZWFyY2ggPSBzZWFyY2g7XG4gICAgICAgIGlmIChhY3RpdmUgIT09IG51bGwpIGNvbmZpZy5wYXJhbXMuYWN0aXZlID0gYWN0aXZlID8gJ3RydWUnIDogJ2ZhbHNlJztcblxuICAgICAgICBnZXQoJy9hcGkvdjEvdXNlcnMnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudXNlcnMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRVc2VyID0gZnVuY3Rpb24gKHVzZXJJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3VzZXJzLycgKyB1c2VySWQsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRHcm91cHMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2dyb3VwcycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZ3JvdXBzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0R3JvdXBzID0gZnVuY3Rpb24gKHVzZXJJZCwgZ3JvdXBJZHMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHB1dCgnL2FwaS92MS91c2Vycy8nICsgdXNlcklkICsgJy9ncm91cHMnLCB7IGdyb3VwSWRzOiBncm91cElkcyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0R3JvdXAgPSBmdW5jdGlvbiAoZ3JvdXBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2dyb3Vwcy8nICsgZ3JvdXBJZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZUdyb3VwID0gZnVuY3Rpb24gKG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbmFtZTogbmFtZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvZ3JvdXBzJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnVwZGF0ZUdyb3VwID0gZnVuY3Rpb24gKGlkLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2dyb3Vwcy8nICsgaWQsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRHcm91cE1lbWJlcnMgPSBmdW5jdGlvbiAoaWQsIHVzZXJJZHMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgdXNlcklkczogdXNlcklkc1xuXG4gICAgICAgIH07XG5cbiAgICAgICAgcHV0KCcvYXBpL3YxL2dyb3Vwcy8nICsgaWQgKyAnL21lbWJlcnMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVtb3ZlR3JvdXAgPSBmdW5jdGlvbiAoZ3JvdXBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGRhdGE6IHt9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvZ3JvdXBzLycgKyBncm91cElkLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHAgPSBmdW5jdGlvbiAoYXBwSWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIHRoYXQuX2FwcFBvc3RQcm9jZXNzKGRhdGEpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwVGFzayA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy90YXNrJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcExpbWl0cyA9IGZ1bmN0aW9uIChhcHBJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy9saW1pdHMnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxpbWl0cyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFwcFdpdGhUYXNrID0gZnVuY3Rpb24gKGFwcElkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgdGhpcy5nZXRBcHAoYXBwSWQsIGZ1bmN0aW9uIChlcnJvciwgYXBwKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgIGlmICghYXBwLnRhc2tJZCkgcmV0dXJuIGNhbGxiYWNrKG51bGwsIGFwcCk7XG5cbiAgICAgICAgICAgIHRoYXQuZ2V0QXBwVGFzayhhcHBJZCwgZnVuY3Rpb24gKGVycm9yLCB0YXNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnByb2dyZXNzID0gdGFzay5wZXJjZW50O1xuICAgICAgICAgICAgICAgICAgICBhcHAubWVzc2FnZSA9IHRhc2subWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gbW9tZW50LmR1cmF0aW9uKG1vbWVudC51dGMoKS5kaWZmKG1vbWVudC51dGModGFzay5jcmVhdGlvblRpbWUpKSkuYXNNaW51dGVzKCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgYXBwLnByb2dyZXNzID0gMDtcbiAgICAgICAgICAgICAgICAgICAgYXBwLm1lc3NhZ2UgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gMDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBhcHApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldENhY2hlZEFwcFN5bmMgPSBmdW5jdGlvbiAoYXBwSWQpIHtcbiAgICAgICAgdmFyIGFwcEZvdW5kID0gbnVsbDtcbiAgICAgICAgdGhpcy5faW5zdGFsbGVkQXBwcy5zb21lKGZ1bmN0aW9uIChhcHApIHtcbiAgICAgICAgICAgIGlmIChhcHAuaWQgPT09IGFwcElkKSB7XG4gICAgICAgICAgICAgICAgYXBwRm91bmQgPSBhcHA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGFwcEZvdW5kO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmRpc2FibGVUd29GYWN0b3JBdXRoZW50aWNhdGlvbkJ5VXNlcklkID0gZnVuY3Rpb24gKHVzZXJJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS91c2Vycy8nICsgdXNlcklkICsgJy90d29mYWN0b3JhdXRoZW50aWNhdGlvbl9kaXNhYmxlJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXR1cCA9IGZ1bmN0aW9uIChkYXRhLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3NldHVwJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZUFkbWluID0gZnVuY3Rpb24gKGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL2FjdGl2YXRlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCByZXN1bHQsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgcmVzdWx0KSk7XG5cbiAgICAgICAgICAgIHRoYXQuc2V0VG9rZW4ocmVzdWx0LnRva2VuKTtcbiAgICAgICAgICAgIHRoYXQuc2V0VXNlckluZm8oeyB1c2VybmFtZTogZGF0YS51c2VybmFtZSwgZW1haWw6IGRhdGEuZW1haWwsIGFkbWluOiB0cnVlLCB0d29GYWN0b3JBdXRoZW50aWNhdGlvbkVuYWJsZWQ6IGZhbHNlLCBzb3VyY2U6ICcnLCBhdmF0YXJVcmw6IG51bGwgfSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdC5hY3RpdmF0ZWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRUb2tlbnMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3Rva2Vucy8nLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRva2Vucyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNyZWF0ZVRva2VuID0gZnVuY3Rpb24gKG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbmFtZTogbmFtZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdG9rZW5zJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBGSVhNRSBjbGFzaGVzIHdpdGggZXhpc3RpbmcgZ2V0VG9rZW4oKVxuICAgIC8vIENsaWVudC5wcm90b3R5cGUuZ2V0VG9rZW4gPSBmdW5jdGlvbiAoaWQsIGNhbGxiYWNrKSB7XG4gICAgLy8gICAgIGdldCgnL2FwaS92MS90b2tlbnMvJyArIGlkLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgIC8vICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgIC8vICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgLy8gICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRva2VuKTtcbiAgICAvLyAgICAgfSk7XG4gICAgLy8gfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZGVsVG9rZW4gPSBmdW5jdGlvbiAodG9rZW5JZCwgY2FsbGJhY2spIHtcbiAgICAgICAgZGVsKCcvYXBpL3YxL3Rva2Vucy8nICsgdG9rZW5JZCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmFkZEFwcFBhc3N3b3JkID0gZnVuY3Rpb24gKGlkZW50aWZpZXIsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgaWRlbnRpZmllcjogaWRlbnRpZmllcixcbiAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcF9wYXNzd29yZHMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwUGFzc3dvcmRzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBfcGFzc3dvcmRzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmRlbEFwcFBhc3N3b3JkID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgICAgICBkZWwoJy9hcGkvdjEvYXBwX3Bhc3N3b3Jkcy8nICsgaWQsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBza2lwQmFja3VwOiAhIW9wdGlvbnMuc2tpcEJhY2t1cFxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vdXBkYXRlJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5pc1JlYm9vdFJlcXVpcmVkID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9yZWJvb3QnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnJlYm9vdFJlcXVpcmVkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVib290ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vcmVib290Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRDZXJ0aWZpY2F0ZSA9IGZ1bmN0aW9uIChjZXJ0aWZpY2F0ZUZpbGUsIGtleUZpbGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgY2VydDogY2VydGlmaWNhdGVGaWxlLFxuICAgICAgICAgICAga2V5OiBrZXlGaWxlXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9zZXR0aW5ncy9jZXJ0aWZpY2F0ZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5kaXNrcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvY2xvdWRyb24vZGlza3MnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUubWVtb3J5ID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9jbG91ZHJvbi9tZW1vcnknLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ3JhcGhzID0gZnVuY3Rpb24gKHRhcmdldHMsIGZyb20sIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgICAgIC8vIGlmIHdlIGhhdmUgYSBsb3Qgb2YgYXBwcywgdGFyZ2V0cyBjYW4gYmUgdmVyeSBsYXJnZS4gbm9kZSB3aWxsIGp1c3QgZGlzY29ubmVjdCBzaW5jZSBpdCBleGNlZWRzIGhlYWRlciBzaXplXG4gICAgICAgIHZhciBzaXplID0gMTAsIGNodW5rcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhcmdldHMubGVuZ3RoOyBpICs9IHNpemUpIHtcbiAgICAgICAgICAgIGNodW5rcy5wdXNoKHRhcmdldHMuc2xpY2UoaSwgaStzaXplKSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIGFzeW5jLmVhY2hTZXJpZXMoY2h1bmtzLCBmdW5jdGlvbiAoY2h1bmssIGl0ZXJhdG9yQ2FsbGJhY2spIHtcbiAgICAgICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldDogY2h1bmssXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdDogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICBmcm9tOiBmcm9tLFxuICAgICAgICAgICAgICAgICAgICB1bnRpbDogJ25vdydcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5ub051bGxQb2ludHMpIGNvbmZpZy5wYXJhbXMubm9OdWxsUG9pbnRzID0gdHJ1ZTtcblxuICAgICAgICAgICAgZ2V0KG9wdGlvbnMuYXBwSWQgPyAnL2FwaS92MS9hcHBzLycgKyBvcHRpb25zLmFwcElkICsgJy9ncmFwaHMnIDogJy9hcGkvdjEvY2xvdWRyb24vZ3JhcGhzJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGl0ZXJhdG9yQ2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGl0ZXJhdG9yQ2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAgICAgLy8gdGhlIGRhdGFwb2ludCByZXR1cm5lZCBoZXJlIGlzIGFuIFt2YWx1ZSwgdGltZXN0YW1wXVxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdC5jb25jYXQoZGF0YSk7XG4gICAgICAgICAgICAgICAgaXRlcmF0b3JDYWxsYmFjayhudWxsKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCBmdW5jdGlvbiBpdGVyYXRvckRvbmUoZXJyb3IpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jcmVhdGVUaWNrZXQgPSBmdW5jdGlvbiAodGlja2V0LCBjYWxsYmFjaykge1xuICAgICAgICAvLyBqdXN0IHRvIGJlIGVwbGljaXQgaGVyZVxuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGVuYWJsZVNzaFN1cHBvcnQ6ICEhdGlja2V0LmVuYWJsZVNzaFN1cHBvcnQsXG4gICAgICAgICAgICB0eXBlOiB0aWNrZXQudHlwZSxcbiAgICAgICAgICAgIHN1YmplY3Q6IHRpY2tldC5zdWJqZWN0LFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IHRpY2tldC5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgIGFwcElkOiB0aWNrZXQuYXBwSWQgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgYWx0RW1haWw6IHRpY2tldC5hbHRFbWFpbCB8fCB1bmRlZmluZWRcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3N1cHBvcnQvdGlja2V0JywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmFkZFVzZXIgPSBmdW5jdGlvbiAodXNlciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBlbWFpbDogdXNlci5lbWFpbCxcbiAgICAgICAgICAgIGZhbGxiYWNrRW1haWw6IHVzZXIuZmFsbGJhY2tFbWFpbCxcbiAgICAgICAgICAgIGRpc3BsYXlOYW1lOiB1c2VyLmRpc3BsYXlOYW1lLFxuICAgICAgICAgICAgcm9sZTogdXNlci5yb2xlXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHVzZXIudXNlcm5hbWUpIGRhdGEudXNlcm5hbWUgPSB1c2VyLnVzZXJuYW1lO1xuICAgICAgICBpZiAodXNlci5wYXNzd29yZCkgZGF0YS5wYXNzd29yZCA9IHVzZXIucGFzc3dvcmQ7XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS91c2VycycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDEpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuaWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVVc2VyID0gZnVuY3Rpb24gKHVzZXIsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZW1haWw6IHVzZXIuZW1haWwsXG4gICAgICAgICAgICBkaXNwbGF5TmFtZTogdXNlci5kaXNwbGF5TmFtZSxcbiAgICAgICAgICAgIGZhbGxiYWNrRW1haWw6IHVzZXIuZmFsbGJhY2tFbWFpbCxcbiAgICAgICAgICAgIGFjdGl2ZTogdXNlci5hY3RpdmUsXG4gICAgICAgICAgICByb2xlOiB1c2VyLnJvbGVcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHVzZXIudXNlcm5hbWUpIGRhdGEudXNlcm5hbWUgPSB1c2VyLnVzZXJuYW1lO1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXIuaWQsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVVc2VyID0gZnVuY3Rpb24gKHVzZXJJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGRhdGE6IHt9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlUHJvZmlsZSA9IGZ1bmN0aW9uIChkYXRhLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL3Byb2ZpbGUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY2hhbmdlQXZhdGFyID0gZnVuY3Rpb24gKGF2YXRhckZpbGVPclR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIC8vIEJsb2IgdHlwZSBpZiBvYmplY3RcbiAgICAgICAgaWYgKHR5cGVvZiBhdmF0YXJGaWxlT3JUeXBlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgdmFyIGZkID0gbmV3IEZvcm1EYXRhKCk7XG4gICAgICAgICAgICBmZC5hcHBlbmQoJ2F2YXRhcicsIGF2YXRhckZpbGVPclR5cGUpO1xuXG4gICAgICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6IHVuZGVmaW5lZCB9LFxuICAgICAgICAgICAgICAgIHRyYW5zZm9ybVJlcXVlc3Q6IGFuZ3VsYXIuaWRlbnRpdHlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS9hdmF0YXInLCBmZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS9hdmF0YXInLCB7IGF2YXRhcjogYXZhdGFyRmlsZU9yVHlwZSA9PT0gJ2dyYXZhdGFyJyA/ICdncmF2YXRhcicgOiAnJyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEJhY2tncm91bmRJbWFnZVVybCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9wcm9maWxlL2JhY2tncm91bmRJbWFnZT9hY2Nlc3NfdG9rZW49JyArIHRva2VuICsgJyZidXN0Y2FjaGU9JyArIERhdGUubm93KCk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0QmFja2dyb3VuZEltYWdlID0gZnVuY3Rpb24gKGJhY2tncm91bmRJbWFnZSwgY2FsbGJhY2spIHtcbiAgICAgICAgLy8gQmxvYiB0eXBlIGlmIG9iamVjdFxuICAgICAgICB2YXIgZmQgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgaWYgKGJhY2tncm91bmRJbWFnZSkgZmQuYXBwZW5kKCdiYWNrZ3JvdW5kSW1hZ2UnLCBiYWNrZ3JvdW5kSW1hZ2UpO1xuXG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiB1bmRlZmluZWQgfSxcbiAgICAgICAgICAgIHRyYW5zZm9ybVJlcXVlc3Q6IGFuZ3VsYXIuaWRlbnRpdHlcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3Byb2ZpbGUvYmFja2dyb3VuZEltYWdlJywgZmQsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5tYWtlVXNlckxvY2FsID0gZnVuY3Rpb24gKHVzZXJJZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS91c2Vycy8nICsgdXNlcklkICsgJy9tYWtlX2xvY2FsJywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5jaGFuZ2VQYXNzd29yZCA9IGZ1bmN0aW9uIChjdXJyZW50UGFzc3dvcmQsIG5ld1Bhc3N3b3JkLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIHBhc3N3b3JkOiBjdXJyZW50UGFzc3dvcmQsXG4gICAgICAgICAgICBuZXdQYXNzd29yZDogbmV3UGFzc3dvcmRcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3Byb2ZpbGUvcGFzc3dvcmQnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0UGFzc3dvcmRSZXNldExpbmsgPSBmdW5jdGlvbiAodXNlcklkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvcGFzc3dvcmRfcmVzZXRfbGluaycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZW5kUGFzc3dvcmRSZXNldEVtYWlsID0gZnVuY3Rpb24gKHVzZXJJZCwgZW1haWwsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvc2VuZF9wYXNzd29yZF9yZXNldF9lbWFpbCcsIHsgZW1haWwgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNlbmRTZWxmUGFzc3dvcmRSZXNldCA9IGZ1bmN0aW9uIChpZGVudGlmaWVyLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3Bhc3N3b3JkX3Jlc2V0X3JlcXVlc3QnLCB7IGlkZW50aWZpZXIgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEludml0ZUxpbmsgPSBmdW5jdGlvbiAodXNlcklkLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvaW52aXRlX2xpbmsnLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2VuZEludml0ZUVtYWlsID0gZnVuY3Rpb24gKHVzZXJJZCwgZW1haWwsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdXNlcnMvJyArIHVzZXJJZCArICcvc2VuZF9pbnZpdGVfZW1haWwnLCB7IGVtYWlsIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRUd29GYWN0b3JBdXRoZW50aWNhdGlvblNlY3JldCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHt9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvcHJvZmlsZS90d29mYWN0b3JhdXRoZW50aWNhdGlvbl9zZWNyZXQnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZW5hYmxlVHdvRmFjdG9yQXV0aGVudGljYXRpb24gPSBmdW5jdGlvbiAodG90cFRva2VuLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIHRvdHBUb2tlbjogdG90cFRva2VuXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9wcm9maWxlL3R3b2ZhY3RvcmF1dGhlbnRpY2F0aW9uX2VuYWJsZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5kaXNhYmxlVHdvRmFjdG9yQXV0aGVudGljYXRpb24gPSBmdW5jdGlvbiAocGFzc3dvcmQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgcGFzc3dvcmQ6IHBhc3N3b3JkXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9wcm9maWxlL3R3b2ZhY3RvcmF1dGhlbnRpY2F0aW9uX2Rpc2FibGUnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0R2hvc3QgPSBmdW5jdGlvbiAodXNlcklkLCBwYXNzd29yZCwgZXhwaXJlc0F0LCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHsgcGFzc3dvcmQgfTtcblxuICAgICAgICBpZiAoZXhwaXJlc0F0KSBkYXRhLmV4cGlyZXNBdCA9IGV4cGlyZXNBdDtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3VzZXJzLycgKyB1c2VySWQgKyAnL2dob3N0JywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnN0YXJ0RXh0ZXJuYWxMZGFwU3luYyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3N5bmNfZXh0ZXJuYWxfbGRhcCcsIHt9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnRhc2tJZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFVzZXJBY3RpdmUgPSBmdW5jdGlvbiAodXNlcklkLCBhY3RpdmUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYWN0aXZlOiBhY3RpdmVcbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3VzZXJzLycgKyB1c2VySWQgKyAnL2FjdGl2ZScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZWZyZXNoVXNlckluZm8gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGNhbGxiYWNrID0gdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nID8gY2FsbGJhY2sgOiBmdW5jdGlvbiAoKSB7fTtcblxuICAgICAgICB0aGlzLnVzZXJJbmZvKGZ1bmN0aW9uIChlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgIHRoYXQuc2V0VXNlckluZm8ocmVzdWx0KTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZWZyZXNoQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBjYWxsYmFjayA9IHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyA/IGNhbGxiYWNrIDogZnVuY3Rpb24gKCkge307XG5cbiAgICAgICAgdGhpcy5jb25maWcoZnVuY3Rpb24gKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcblxuICAgICAgICAgICAgdGhhdC5nZXRVcGRhdGVJbmZvKGZ1bmN0aW9uIChlcnJvciwgaW5mbykgeyAvLyBub3RlOiBub24tYWRtaW4gdXNlcnMgbWF5IGdldCBhY2Nlc3MgZGVuaWVkIGZvciB0aGlzXG4gICAgICAgICAgICAgICAgaWYgKCFlcnJvcikgcmVzdWx0LnVwZGF0ZSA9IGluZm8udXBkYXRlOyAvLyBhdHRhY2ggdXBkYXRlIGluZm9ybWF0aW9uIHRvIGNvbmZpZyBvYmplY3RcblxuICAgICAgICAgICAgICAgIHRoYXQuc2V0Q29uZmlnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVmcmVzaEF2YWlsYWJsZUxhbmd1YWdlcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL2Nsb3Vkcm9uL2xhbmd1YWdlcycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGFuZ3VsYXIuY29weShkYXRhLmxhbmd1YWdlcywgdGhhdC5fYXZhaWxhYmxlTGFuZ3VhZ2VzKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5sYW5ndWFnZXMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5fYXBwUG9zdFByb2Nlc3MgPSBmdW5jdGlvbiAoYXBwKSB7XG4gICAgICAgIC8vIGNhbGN1bGF0ZSB0aGUgaWNvbiBwYXRoc1xuICAgICAgICBhcHAuaWNvblVybCA9IGFwcC5pY29uVXJsID8gKHRoaXMuYXBpT3JpZ2luICsgYXBwLmljb25VcmwgKyAnP2FjY2Vzc190b2tlbj0nICsgdG9rZW4gKyAnJnRzPScgKyBhcHAudHMpIDogbnVsbDtcblxuICAgICAgICAvLyBhbWVuZCB0aGUgcG9zdCBpbnN0YWxsIGNvbmZpcm0gc3RhdGVcbiAgICAgICAgYXBwLnBlbmRpbmdQb3N0SW5zdGFsbENvbmZpcm1hdGlvbiA9ICEhbG9jYWxTdG9yYWdlWydjb25maXJtUG9zdEluc3RhbGxfJyArIGFwcC5pZF07XG5cbiAgICAgICAgaWYgKGFwcC5tYW5pZmVzdC51cHN0cmVhbVZlcnNpb24pIHtcbiAgICAgICAgICAgIGFwcC51cHN0cmVhbVZlcnNpb24gPSBhcHAubWFuaWZlc3QudXBzdHJlYW1WZXJzaW9uO1xuICAgICAgICB9IGVsc2UgaWYgKGFwcC5tYW5pZmVzdC5kZXNjcmlwdGlvbikgeyAvLyBjYW4gYmUgZW1wdHkgZm9yIGRldiBhcHBzXG4gICAgICAgICAgICB2YXIgdG1wID0gYXBwLm1hbmlmZXN0LmRlc2NyaXB0aW9uLm1hdGNoKC9cXDx1cHN0cmVhbVxcPiguKilcXDxcXC91cHN0cmVhbVxcPi9pKTtcbiAgICAgICAgICAgIGFwcC51cHN0cmVhbVZlcnNpb24gPSAodG1wICYmIHRtcFsxXSkgPyB0bXBbMV0gOiAnJztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGFwcC51cHN0cmVhbVZlcnNpb24gPSAnJztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghYXBwLm1hbmlmZXN0LnRpdGxlKSBhcHAubWFuaWZlc3QudGl0bGUgPSAnVW50aXRsZWQnO1xuXG4gICAgICAgIGlmIChhcHAubWFuaWZlc3QucG9zdEluc3RhbGxNZXNzYWdlKSB7XG4gICAgICAgICAgICB2YXIgdGV4dD0gYXBwLm1hbmlmZXN0LnBvc3RJbnN0YWxsTWVzc2FnZTtcbiAgICAgICAgICAgIC8vIHdlIGNob3NlIC0gYmVjYXVzZSB1bmRlcnNjb3JlIGhhcyBzcGVjaWFsIG1lYW5pbmcgaW4gbWFya2Rvd25cbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcJENMT1VEUk9OLUFQUC1MT0NBVElPTi9nLCBhcHAuc3ViZG9tYWluKTtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcJENMT1VEUk9OLUFQUC1ET01BSU4vZywgYXBwLmRvbWFpbik7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1BUFAtRlFETi9nLCBhcHAuZnFkbik7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1BUFAtT1JJR0lOL2csICdodHRwczovLycgKyBhcHAuZnFkbik7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1BUEktRE9NQUlOL2csIHRoaXMuX2NvbmZpZy5hZG1pbkZxZG4pO1xuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFwkQ0xPVURST04tQVBJLU9SSUdJTi9nLCAnaHR0cHM6Ly8nICsgdGhpcy5fY29uZmlnLmFkbWluRnFkbik7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1VU0VSTkFNRS9nLCB0aGlzLl91c2VySW5mby51c2VybmFtZSk7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCRDTE9VRFJPTi1BUFAtSUQvZywgYXBwLmlkKTtcblxuICAgICAgICAgICAgLy8gW15dIG1hdGNoZXMgZXZlbiBuZXdsaW5lcy4gJz8nIG1ha2VzIGl0IG5vbi1ncmVlZHlcbiAgICAgICAgICAgIGlmIChhcHAuc3NvKSB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88bm9zc28+W15dKj88XFwvbm9zc28+L2csICcnKTtcbiAgICAgICAgICAgIGVsc2UgdGV4dCA9IHRleHQucmVwbGFjZSgvPHNzbz5bXl0qPzxcXC9zc28+L2csICcnKTtcblxuICAgICAgICAgICAgYXBwLm1hbmlmZXN0LnBvc3RJbnN0YWxsTWVzc2FnZSA9IHRleHQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXBwO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBiaW5hcnlTZWFyY2goYXJyYXksIHByZWQpIHtcbiAgICAgICAgdmFyIGxvID0gLTEsIGhpID0gYXJyYXkubGVuZ3RoO1xuICAgICAgICB3aGlsZSAoMSArIGxvICE9PSBoaSkge1xuICAgICAgICAgICAgdmFyIG1pID0gbG8gKyAoKGhpIC0gbG8pID4+IDEpO1xuICAgICAgICAgICAgaWYgKHByZWQoYXJyYXlbbWldKSkge1xuICAgICAgICAgICAgICAgIGhpID0gbWk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvID0gbWk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGhpO1xuICAgIH1cblxuICAgIENsaWVudC5wcm90b3R5cGUuX3VwZGF0ZUFwcENhY2hlID0gZnVuY3Rpb24gKGFwcCkge1xuICAgICAgICB2YXIgdG1wID0ge307XG4gICAgICAgIGFuZ3VsYXIuY29weShhcHAsIHRtcCk7XG5cbiAgICAgICAgdmFyIGZvdW5kSW5kZXggPSB0aGlzLl9pbnN0YWxsZWRBcHBzLmZpbmRJbmRleChmdW5jdGlvbiAoYSkgeyByZXR1cm4gYS5pZCA9PT0gYXBwLmlkOyB9KTtcblxuICAgICAgICAvLyB3ZSByZXBsYWNlIG5ldyBkYXRhIGludG8gdGhlIGV4aXN0aW5nIHJlZmVyZW5jZSB0byBrZWVwIGFuZ3VsYXIgYmluZGluZ3NcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICBhbmd1bGFyLmNvcHkodG1wLCB0aGlzLl9pbnN0YWxsZWRBcHBzW2ZvdW5kSW5kZXhdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2luc3RhbGxlZEFwcHMucHVzaCh0bXApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRkIHJlZmVyZW5jZSB0byBvYmplY3QgbWFwIHdpdGggYXBwSWQga2V5c1xuICAgICAgICB0aGlzLl9pbnN0YWxsZWRBcHBzQnlJZFthcHAuaWRdID0gdGhpcy5faW5zdGFsbGVkQXBwc1tmb3VuZEluZGV4XTtcblxuICAgICAgICAvLyBUT0RPIHRoaXMgbm90IHZlcnkgZWxlZ2FudFxuICAgICAgICAvLyB1cGRhdGUgYXBwIHRhZ3NcbiAgICAgICAgdG1wID0gdGhpcy5faW5zdGFsbGVkQXBwc1xuICAgICAgICAgICAgLm1hcChmdW5jdGlvbiAoYXBwKSB7IHJldHVybiBhcHAudGFncyB8fCBbXTsgfSkgICAgICAgICAgICAgICAgICAgICAvLyByZXR1cm4gYXJyYXkgb2YgYXJyYXlzXG4gICAgICAgICAgICAucmVkdWNlKGZ1bmN0aW9uIChhLCBpKSB7IHJldHVybiBhLmNvbmNhdChpKTsgfSwgW10pICAgICAgICAgICAgICAgIC8vIG1lcmdlIGFsbCBhcnJheXMgaW50byBvbmVcbiAgICAgICAgICAgIC5maWx0ZXIoZnVuY3Rpb24gKHYsIGksIHNlbGYpIHsgcmV0dXJuIHNlbGYuaW5kZXhPZih2KSA9PT0gaTsgfSkgICAgLy8gZmlsdGVyIGR1cGxpY2F0ZXNcbiAgICAgICAgICAgIC5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhLmxvY2FsZUNvbXBhcmUoYik7IH0pOyAgICAgICAgICAgICAgLy8gc29ydFxuXG4gICAgICAgIC8vIGtlZXAgdGFnIGFycmF5IHJlZmVyZW5jZXNcbiAgICAgICAgYW5ndWxhci5jb3B5KHRtcCwgdGhpcy5fYXBwVGFncyk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVmcmVzaEluc3RhbGxlZEFwcHMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2sgPSBjYWxsYmFjayB8fCBmdW5jdGlvbiAoZXJyb3IpIHsgaWYgKGVycm9yKSBjb25zb2xlLmVycm9yKGVycm9yKTsgfTtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIHRoaXMuZ2V0QXBwcyhmdW5jdGlvbiAoZXJyb3IsIGFwcHMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcblxuICAgICAgICAgICAgYXN5bmMuZWFjaExpbWl0KGFwcHMsIDIwLCBmdW5jdGlvbiAoYXBwLCBpdGVyYXRvckNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgYXBwLnNzb0F1dGggPSAoYXBwLm1hbmlmZXN0LmFkZG9uc1snbGRhcCddIHx8IGFwcC5tYW5pZmVzdC5hZGRvbnNbJ3Byb3h5QXV0aCddKSAmJiBhcHAuc3NvO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFwcC5hY2Nlc3NMZXZlbCAhPT0gJ29wZXJhdG9yJyAmJiBhcHAuYWNjZXNzTGV2ZWwgIT09ICdhZG1pbicpIHsgLy8gb25seSBmZXRjaCBpZiB3ZSBoYXZlIHBlcm1pc3Npb25zXG4gICAgICAgICAgICAgICAgICAgIGFwcC5wcm9ncmVzcyA9IDA7XG4gICAgICAgICAgICAgICAgICAgIGFwcC5tZXNzYWdlID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIGFwcC50YXNrTWludXRlc0FjdGl2ZSA9IDA7XG5cbiAgICAgICAgICAgICAgICAgICAgdGhhdC5fdXBkYXRlQXBwQ2FjaGUoYXBwKTtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaXRlcmF0b3JDYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBnZXRUYXNrRnVuYyA9IGFwcC50YXNrSWQgPyB0aGF0LmdldEFwcFRhc2suYmluZChudWxsLCBhcHAuaWQpIDogZnVuY3Rpb24gKG5leHQpIHsgcmV0dXJuIG5leHQoKTsgfTtcbiAgICAgICAgICAgICAgICBnZXRUYXNrRnVuYyhmdW5jdGlvbiAoZXJyb3IsIHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gaXRlcmF0b3JDYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRhc2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC5wcm9ncmVzcyA9IHRhc2sucGVyY2VudDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC5tZXNzYWdlID0gdGFzay5tZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBwLnRhc2tNaW51dGVzQWN0aXZlID0gbW9tZW50LmR1cmF0aW9uKG1vbWVudC51dGMoKS5kaWZmKG1vbWVudC51dGModGFzay5jcmVhdGlvblRpbWUpKSkuYXNNaW51dGVzKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhcHAucHJvZ3Jlc3MgPSAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBwLm1lc3NhZ2UgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcC50YXNrTWludXRlc0FjdGl2ZSA9IDA7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll91cGRhdGVBcHBDYWNoZShhcHApO1xuXG4gICAgICAgICAgICAgICAgICAgIGl0ZXJhdG9yQ2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIGl0ZXJhdG9yRG9uZShlcnJvcikge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcblxuICAgICAgICAgICAgICAgIC8vIGZpbHRlciBvdXQgb2xkIGFwcHMsIGdvaW5nIGJhY2t3YXJkcyB0byBhbGxvdyBzcGxpY2luZ1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSB0aGF0Ll9pbnN0YWxsZWRBcHBzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghYXBwcy5zb21lKGZ1bmN0aW9uIChlbGVtKSB7IHJldHVybiAoZWxlbS5pZCA9PT0gdGhhdC5faW5zdGFsbGVkQXBwc1tpXS5pZCk7IH0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVtb3ZlZCA9IHRoYXQuX2luc3RhbGxlZEFwcHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHRoYXQuX2luc3RhbGxlZEFwcHNCeUlkW3JlbW92ZWRbMF0uaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUubG9naW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuc2V0VG9rZW4obnVsbCk7XG5cbiAgICAgICAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSAnL2xvZ2luLmh0bWw/cmV0dXJuVG89LycgKyBlbmNvZGVVUklDb21wb25lbnQod2luZG93LmxvY2F0aW9uLmhhc2gpO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmxvZ291dCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHRva2VuID0gdGhpcy5nZXRUb2tlbigpO1xuICAgICAgICB0aGlzLnNldFRva2VuKG51bGwpO1xuXG4gICAgICAgIC8vIGludmFsaWRhdGVzIHRoZSB0b2tlblxuICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9IGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS9jbG91ZHJvbi9sb2dvdXQ/YWNjZXNzX3Rva2VuPScgKyB0b2tlbjtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBFdmVudExvZyA9IGZ1bmN0aW9uIChhcHBJZCwgcGFnZSwgcGVyUGFnZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgIHBhZ2U6IHBhZ2UsXG4gICAgICAgICAgICAgICAgcGVyX3BhZ2U6IHBlclBhZ2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvYXBwcy8nICsgYXBwSWQgKyAnL2V2ZW50bG9nJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmV2ZW50bG9ncyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cblxuICAgIENsaWVudC5wcm90b3R5cGUudXBsb2FkRmlsZSA9IGZ1bmN0aW9uIChhcHBJZCwgZmlsZSwgcHJvZ3Jlc3NDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGZkID0gbmV3IEZvcm1EYXRhKCk7XG4gICAgICAgIGZkLmFwcGVuZCgnZmlsZScsIGZpbGUpO1xuXG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiB1bmRlZmluZWQgfSxcbiAgICAgICAgICAgIHRyYW5zZm9ybVJlcXVlc3Q6IGFuZ3VsYXIuaWRlbnRpdHksXG4gICAgICAgICAgICB1cGxvYWRFdmVudEhhbmRsZXJzOiB7XG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IHByb2dyZXNzQ2FsbGJhY2tcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2FwcHMvJyArIGFwcElkICsgJy91cGxvYWQ/ZmlsZT0nICsgZW5jb2RlVVJJQ29tcG9uZW50KCcvdG1wLycgKyBmaWxlLm5hbWUpLCBmZCwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuY2hlY2tEb3dubG9hZGFibGVGaWxlID0gZnVuY3Rpb24gKGFwcElkLCBmaWxlUGF0aCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6IHVuZGVmaW5lZCB9XG4gICAgICAgIH07XG5cbiAgICAgICAgaGVhZCgnL2FwaS92MS9hcHBzLycgKyBhcHBJZCArICcvZG93bmxvYWQ/ZmlsZT0nICsgZW5jb2RlVVJJQ29tcG9uZW50KGZpbGVQYXRoKSwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2VuZFRlc3RNYWlsID0gZnVuY3Rpb24gKGRvbWFpbiwgdG8sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgdG86IHRvXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL3NlbmRfdGVzdF9tYWlsJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBEb21haW5zXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXREb21haW5zID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9kb21haW5zJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5kb21haW5zKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0RG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2RvbWFpbnMvJyArIGRvbWFpbiwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmNoZWNrRE5TUmVjb3JkcyA9IGZ1bmN0aW9uIChkb21haW4sIHN1YmRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL2RvbWFpbnMvJyArIGRvbWFpbiArICcvZG5zX2NoZWNrP3N1YmRvbWFpbj0nICsgc3ViZG9tYWluLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYWRkRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgem9uZU5hbWUsIHByb3ZpZGVyLCBjb25maWcsIGZhbGxiYWNrQ2VydGlmaWNhdGUsIHRsc0NvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBkb21haW46IGRvbWFpbixcbiAgICAgICAgICAgIHByb3ZpZGVyOiBwcm92aWRlcixcbiAgICAgICAgICAgIGNvbmZpZzogY29uZmlnLFxuICAgICAgICAgICAgdGxzQ29uZmlnOiB0bHNDb25maWcsXG4gICAgICAgIH07XG4gICAgICAgIGlmICh6b25lTmFtZSkgZGF0YS56b25lTmFtZSA9IHpvbmVOYW1lO1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgaWYgKGZhbGxiYWNrQ2VydGlmaWNhdGUpIGRhdGEuZmFsbGJhY2tDZXJ0aWZpY2F0ZSA9IGZhbGxiYWNrQ2VydGlmaWNhdGU7XG5cbiAgICAgICAgLy8gaGFjayB1bnRpbCB3ZSBmaXggdGhlIGRvbWFpbnMuanNcbiAgICAgICAgcG9zdCgnL2FwaS92MS9kb21haW5zJywgZGF0YSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlRG9tYWluQ29uZmlnID0gZnVuY3Rpb24gKGRvbWFpbiwgem9uZU5hbWUsIHByb3ZpZGVyLCBjb25maWcsIGZhbGxiYWNrQ2VydGlmaWNhdGUsIHRsc0NvbmZpZywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBwcm92aWRlcjogcHJvdmlkZXIsXG4gICAgICAgICAgICBjb25maWc6IGNvbmZpZyxcbiAgICAgICAgICAgIHRsc0NvbmZpZzogdGxzQ29uZmlnXG4gICAgICAgIH07XG4gICAgICAgIGlmICh6b25lTmFtZSkgZGF0YS56b25lTmFtZSA9IHpvbmVOYW1lO1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgaWYgKGZhbGxiYWNrQ2VydGlmaWNhdGUpIGRhdGEuZmFsbGJhY2tDZXJ0aWZpY2F0ZSA9IGZhbGxiYWNrQ2VydGlmaWNhdGU7XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9kb21haW5zLycgKyBkb21haW4gKyAnL2NvbmZpZycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIHRoYXQuc2V0RG5zUmVjb3Jkcyh7IGRvbWFpbjogZG9tYWluLCB0eXBlOiAnbWFpbCcgfSwgY2FsbGJhY2spOyAvLyB0aGlzIGlzIGRvbmUgc28gdGhhdCBhbiBvdXQtb2Ytc3luYyBka2ltIGtleSBjYW4gYmUgc3luY2VkXG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnVwZGF0ZURvbWFpbldlbGxLbm93biA9IGZ1bmN0aW9uIChkb21haW4sIHdlbGxLbm93biwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICB3ZWxsS25vd246IHdlbGxLbm93blxuICAgICAgICB9O1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9kb21haW5zLycgKyBkb21haW4gKyAnL3dlbGxrbm93bicsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW5ld0NlcnRzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vcmVuZXdfY2VydHMnLCB7fSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVEb21haW4gPSBmdW5jdGlvbiAoZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZGVsKCcvYXBpL3YxL2RvbWFpbnMvJyArIGRvbWFpbiwgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucHJlcGFyZURhc2hib2FyZERvbWFpbiA9IGZ1bmN0aW9uIChkb21haW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgZG9tYWluOiBkb21haW5cbiAgICAgICAgfTtcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3ByZXBhcmVfZGFzaGJvYXJkX2RvbWFpbicsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEudGFza0lkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RGFzaGJvYXJkRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBkb21haW46IGRvbWFpblxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvY2xvdWRyb24vc2V0X2Rhc2hib2FyZF9kb21haW4nLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIEVtYWlsXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsRXZlbnRMb2dzID0gZnVuY3Rpb24gKHNlYXJjaCwgdHlwZXMsIHBhZ2UsIHBlclBhZ2UsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICBwYWdlOiBwYWdlLFxuICAgICAgICAgICAgICAgIHR5cGVzOiB0eXBlcyxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZSxcbiAgICAgICAgICAgICAgICBzZWFyY2g6IHNlYXJjaFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsc2VydmVyL2V2ZW50bG9nJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZXZlbnRsb2dzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbFVzYWdlID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHtcbiAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgIGRvbWFpbjogZG9tYWluXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWxzZXJ2ZXIvdXNhZ2UnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnVzYWdlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbExvY2F0aW9uID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9sb2NhdGlvbicsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpOyAvLyB7IHN1YmRvbWFpbiwgZG9tYWluIH1cbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0TWFpbExvY2F0aW9uID0gZnVuY3Rpb24gKHN1YmRvbWFpbiwgZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvbG9jYXRpb24nLCB7IHN1YmRvbWFpbjogc3ViZG9tYWluLCBkb21haW46IGRvbWFpbiB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7IHRhc2tJZDogZGF0YS50YXNrSWQgfSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldE1heEVtYWlsU2l6ZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge307XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWxzZXJ2ZXIvbWF4X2VtYWlsX3NpemUnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLnNpemUpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRNYXhFbWFpbFNpemUgPSBmdW5jdGlvbiAoc2l6ZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsc2VydmVyL21heF9lbWFpbF9zaXplJywgeyBzaXplOiBzaXplIH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsYm94U2hhcmluZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9tYWlsYm94X3NoYXJpbmcnLCB7fSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxib3hTaGFyaW5nID0gZnVuY3Rpb24gKGVuYWJsZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsc2VydmVyL21haWxib3hfc2hhcmluZycsIHsgZW5hYmxlOiBlbmFibGUgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldERuc2JsQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9kbnNibF9jb25maWcnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RG5zYmxDb25maWcgPSBmdW5jdGlvbiAoem9uZXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbHNlcnZlci9kbnNibF9jb25maWcnLCB7IHpvbmVzOiB6b25lcyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U29sckNvbmZpZyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge307XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc29scl9jb25maWcnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0U29sckNvbmZpZyA9IGZ1bmN0aW9uIChlbmFibGVkLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc29scl9jb25maWcnLCB7IGVuYWJsZWQ6IGVuYWJsZWQgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFNwYW1BY2wgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IHt9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsc2VydmVyL3NwYW1fYWNsJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFNwYW1BY2wgPSBmdW5jdGlvbiAoYWNsLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc3BhbV9hY2wnLCB7IHdoaXRlbGlzdDogYWNsLndoaXRlbGlzdCwgYmxhY2tsaXN0OiBhY2wuYmxhY2tsaXN0IH0sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRTcGFtQ3VzdG9tQ29uZmlnID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7fTtcblxuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbHNlcnZlci9zcGFtX2N1c3RvbV9jb25maWcnLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmNvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldFNwYW1DdXN0b21Db25maWcgPSBmdW5jdGlvbiAoY29uZmlnLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL21haWxzZXJ2ZXIvc3BhbV9jdXN0b21fY29uZmlnJywgeyBjb25maWc6IGNvbmZpZyB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbENvbmZpZ0ZvckRvbWFpbiA9IGZ1bmN0aW9uIChkb21haW4sIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5lbmFibGVNYWlsRm9yRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgZW5hYmxlZCwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2VuYWJsZScsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0RG5zUmVjb3JkcyA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICAgICAgICBwb3N0KCcvYXBpL3YxL2Nsb3Vkcm9uL3N5bmNfZG5zJywgb3B0aW9ucywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS50YXNrSWQpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsU3RhdHVzRm9yRG9tYWluID0gZnVuY3Rpb24gKGRvbWFpbiwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvc3RhdHVzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxSZWxheSA9IGZ1bmN0aW9uIChkb21haW4sIGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9yZWxheScsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRNYWlsQmFubmVyID0gZnVuY3Rpb24gKGRvbWFpbiwgZGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2Jhbm5lcicsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5zZXRDYXRjaGFsbEFkZHJlc3NlcyA9IGZ1bmN0aW9uIChkb21haW4sIGFkZHJlc3NlcywgY2FsbGJhY2spIHtcbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2NhdGNoX2FsbCcsIHsgYWRkcmVzc2VzOiBhZGRyZXNzZXMgfSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMikgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnNldE1haWxGcm9tVmFsaWRhdGlvbiA9IGZ1bmN0aW9uIChkb21haW4sIGVuYWJsZWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsX2Zyb21fdmFsaWRhdGlvbicsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAyKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIE1haWxib3hlc1xuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QWxsTWFpbGJveGVzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICB0aGlzLmdldERvbWFpbnMoZnVuY3Rpb24gKGVycm9yLCBkb21haW5zKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG5cbiAgICAgICAgICAgIHZhciBtYWlsYm94ZXMgPSBbXTtcbiAgICAgICAgICAgIGFzeW5jLmVhY2hMaW1pdChkb21haW5zLCA1LCBmdW5jdGlvbiAoZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIHRoYXQubGlzdE1haWxib3hlcyhkb21haW4uZG9tYWluLCAnJywgMSwgMTAwMCwgZnVuY3Rpb24gKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgICAgIG1haWxib3hlcyA9IG1haWxib3hlcy5jb25jYXQocmVzdWx0KTtcblxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgbWFpbGJveGVzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRNYWlsYm94Q291bnQgPSBmdW5jdGlvbiAoZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94X2NvdW50JywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5jb3VudCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmxpc3RNYWlsYm94ZXMgPSBmdW5jdGlvbiAoZG9tYWluLCBzZWFyY2gsIHBhZ2UsIHBlclBhZ2UsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICBzZWFyY2g6IHNlYXJjaCxcbiAgICAgICAgICAgICAgICBwYWdlOiBwYWdlLFxuICAgICAgICAgICAgICAgIHBlcl9wYWdlOiBwZXJQYWdlXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZ2V0KCcvYXBpL3YxL21haWwvJyArIGRvbWFpbiArICcvbWFpbGJveGVzJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLm1haWxib3hlcyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldE1haWxib3ggPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMvJyArIG5hbWUsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEubWFpbGJveCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmFkZE1haWxib3ggPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBvd25lcklkLCBvd25lclR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgICAgIG93bmVySWQ6IG93bmVySWQsXG4gICAgICAgICAgICBvd25lclR5cGU6IG93bmVyVHlwZSxcbiAgICAgICAgICAgIGFjdGl2ZTogdHJ1ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlTWFpbGJveCA9IGZ1bmN0aW9uIChkb21haW4sIG5hbWUsIGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMvJyArIG5hbWUsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVNYWlsYm94ID0gZnVuY3Rpb24gKGRvbWFpbiwgbmFtZSwgZGVsZXRlTWFpbHMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlTWFpbHM6IGRlbGV0ZU1haWxzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9tYWlsYm94ZXMvJyArIG5hbWUsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMSkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldEFsaWFzZXMgPSBmdW5jdGlvbiAobmFtZSwgZG9tYWluLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcGFnZTogMSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogMTAwMFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL21haWxib3hlcy8nICsgbmFtZSArICcvYWxpYXNlcycsIGNvbmZpZywgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5hbGlhc2VzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuc2V0QWxpYXNlcyA9IGZ1bmN0aW9uIChuYW1lLCBkb21haW4sIGFsaWFzZXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgYWxpYXNlczogYWxpYXNlc1xuICAgICAgICB9O1xuXG4gICAgICAgIHB1dCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL21haWxib3hlcy8nICsgbmFtZSArICcvYWxpYXNlcycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5saXN0TWFpbGluZ0xpc3RzID0gZnVuY3Rpb24gKGRvbWFpbiwgc2VhcmNoLCBwYWdlLCBwZXJQYWdlLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgY29uZmlnID0ge1xuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgc2VhcmNoOiBzZWFyY2gsXG4gICAgICAgICAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgICAgICAgICBwZXJfcGFnZTogcGVyUGFnZVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2xpc3RzJywgY29uZmlnLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmxpc3RzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0TWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBnZXQoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cy8nICsgbmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5saXN0KTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuYWRkTWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBtZW1iZXJzLCBtZW1iZXJzT25seSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICAgICAgbWVtYmVyczogbWVtYmVycyxcbiAgICAgICAgICAgIG1lbWJlcnNPbmx5OiBtZW1iZXJzT25seSxcbiAgICAgICAgICAgIGFjdGl2ZTogdHJ1ZVxuICAgICAgICB9O1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cycsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDEpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS51cGRhdGVNYWlsaW5nTGlzdCA9IGZ1bmN0aW9uIChkb21haW4sIG5hbWUsIG1lbWJlcnMsIG1lbWJlcnNPbmx5LCBhY3RpdmUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBkYXRhID0ge1xuICAgICAgICAgICAgbWVtYmVyczogbWVtYmVycyxcbiAgICAgICAgICAgIG1lbWJlcnNPbmx5OiBtZW1iZXJzT25seSxcbiAgICAgICAgICAgIGFjdGl2ZTogYWN0aXZlXG4gICAgICAgIH07XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS9tYWlsLycgKyBkb21haW4gKyAnL2xpc3RzLycgKyBuYW1lLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjA0KSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVtb3ZlTWFpbGluZ0xpc3QgPSBmdW5jdGlvbiAoZG9tYWluLCBuYW1lLCBjYWxsYmFjaykge1xuICAgICAgICBkZWwoJy9hcGkvdjEvbWFpbC8nICsgZG9tYWluICsgJy9saXN0cy8nICsgbmFtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwNCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyBWb2x1bWVzXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRWb2x1bWVzID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS92b2x1bWVzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS52b2x1bWVzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0Vm9sdW1lID0gZnVuY3Rpb24gKHZvbHVtZSwgY2FsbGJhY2spIHtcbiAgICAgICAgZ2V0KCcvYXBpL3YxL3ZvbHVtZXMvJyArIHZvbHVtZSwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmdldFZvbHVtZVN0YXR1cyA9IGZ1bmN0aW9uICh2b2x1bWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS92b2x1bWVzLycgKyB2b2x1bWUgKyAnL3N0YXR1cycsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5hZGRWb2x1bWUgPSBmdW5jdGlvbiAobmFtZSwgbW91bnRUeXBlLCBob3N0UGF0aCwgbW91bnRPcHRpb25zLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgICAgICBtb3VudFR5cGU6IG1vdW50VHlwZSxcbiAgICAgICAgICAgIG1vdW50T3B0aW9uczogbW91bnRPcHRpb25zXG4gICAgICAgIH07XG4gICAgICAgIGlmIChob3N0UGF0aCkgZGF0YS5ob3N0UGF0aCA9IGhvc3RQYXRoO1xuXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3ZvbHVtZXMnLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhLmlkKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUudXBkYXRlVm9sdW1lID0gZnVuY3Rpb24gKHZvbHVtZUlkLCBtb3VudFR5cGUsIG1vdW50T3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGRhdGEgPSB7XG4gICAgICAgICAgICBtb3VudFR5cGU6IG1vdW50VHlwZSxcbiAgICAgICAgICAgIG1vdW50T3B0aW9uczogbW91bnRPcHRpb25zXG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvdm9sdW1lcy8nICsgdm9sdW1lSWQsIGRhdGEsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlbW91bnRWb2x1bWUgPSBmdW5jdGlvbiAodm9sdW1lSWQsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcblxuICAgICAgICBwb3N0KCcvYXBpL3YxL3ZvbHVtZXMvJyArIHZvbHVtZUlkICsgJy9yZW1vdW50Jywge30sIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDIpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLnJlbW92ZVZvbHVtZSA9IGZ1bmN0aW9uICh2b2x1bWUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvdm9sdW1lcy8nICsgdm9sdW1lLCBjb25maWcsIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDQpIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLy8gVGhpcyB3aWxsIGNoYW5nZSB0aGUgbG9jYXRpb25cbiAgICBDbGllbnQucHJvdG90eXBlLm9wZW5TdWJzY3JpcHRpb25TZXR1cCA9IGZ1bmN0aW9uIChzdWJzY3JpcHRpb24pIHtcbiAgICAgICAgLy8gd2Ugb25seSBhbGxvdyB0aGUgb3duZXIgdG8gZG8gc29cbiAgICAgICAgaWYgKCF0aGlzLl91c2VySW5mby5pc0F0TGVhc3RPd25lcikgcmV0dXJuO1xuXG4gICAgICAgIC8vIGJhc2ljYWxseSB0aGUgdXNlciBoYXMgbm90IHNldHVwIGFwcHN0b3JlIGFjY291bnQgeWV0XG4gICAgICAgIGlmICghc3Vic2NyaXB0aW9uLnBsYW4pIHJldHVybiB3aW5kb3cubG9jYXRpb24uaHJlZiA9ICcvIy9hcHBzdG9yZSc7XG5cbiAgICAgICAgaWYgKHN1YnNjcmlwdGlvbi5wbGFuLmlkID09PSAnZnJlZScpIHdpbmRvdy5vcGVuKHRoaXMuZ2V0Q29uZmlnKCkuY29uc29sZVNlcnZlck9yaWdpbiArICcvIy9zdWJzY3JpcHRpb25fc2V0dXAvJyArIHN1YnNjcmlwdGlvbi5jbG91ZHJvbklkICsgJz9lbWFpbD0nICsgc3Vic2NyaXB0aW9uLmVtYWlsRW5jb2RlZCwgJ19ibGFuaycpO1xuICAgICAgICBlbHNlIHdpbmRvdy5vcGVuKHRoaXMuZ2V0Q29uZmlnKCkuY29uc29sZVNlcnZlck9yaWdpbiArICcvIy9jbG91ZHJvbi8nICsgc3Vic2NyaXB0aW9uLmNsb3Vkcm9uSWQgKyAnP2VtYWlsPScgKyBzdWJzY3JpcHRpb24uZW1haWxFbmNvZGVkLCAnX2JsYW5rJyk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwc3RvcmVBcHBCeUlkQW5kVmVyc2lvbiA9IGZ1bmN0aW9uIChhcHBJZCwgdmVyc2lvbiwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHVybCA9ICcvYXBpL3YxL2FwcHN0b3JlL2FwcHMvJyArIGFwcElkO1xuICAgICAgICBpZiAodmVyc2lvbiAmJiB2ZXJzaW9uICE9PSAnbGF0ZXN0JykgdXJsICs9ICcvdmVyc2lvbnMvJyArIHZlcnNpb247XG5cbiAgICAgICAgZ2V0KHVybCwgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLl9vbkFwcHN0b3JlQXBwcyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBpZiAoIXRoaXMuX2ZldGNoaW5nQXBwc3RvcmVBcHBzKSB7Y29uc29sZS5sb2coJ25vdCBmZXRjaGluZycpOyBjYWxsYmFjaygpOyB9XG4gICAgICAgIGVsc2UgdGhpcy5fZmV0Y2hpbmdBcHBzdG9yZUFwcHNMaXN0ZW5lci5wdXNoKGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5nZXRBcHBzdG9yZUFwcHMgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuXG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBzdG9yZS9hcHBzJywgbnVsbCwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgYW5ndWxhci5jb3B5KGRhdGEuYXBwcywgdGhhdC5fYXBwc3RvcmVBcHBDYWNoZSk7XG5cbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCB0aGF0Ll9hcHBzdG9yZUFwcENhY2hlKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0QXBwc3RvcmVBcHBzRmFzdCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBpZiAodGhpcy5fYXBwc3RvcmVBcHBDYWNoZS5sZW5ndGggIT09IDApIHJldHVybiBjYWxsYmFjayhudWxsLCB0aGlzLl9hcHBzdG9yZUFwcENhY2hlKTtcblxuICAgICAgICB0aGlzLmdldEFwcHN0b3JlQXBwcyhjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZ2V0U3Vic2NyaXB0aW9uID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgIGdldCgnL2FwaS92MS9hcHBzdG9yZS9zdWJzY3JpcHRpb24nLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICAvLyBqdXN0IHNvbWUgaGVscGVyIHByb3BlcnR5LCBzaW5jZSBhbmd1bGFyIGJpbmRpbmdzIGNhbm5vdCBkb3QgaGlzIGVhc2lseVxuICAgICAgICAgICAgZGF0YS5lbWFpbEVuY29kZWQgPSBlbmNvZGVVUklDb21wb25lbnQoZGF0YS5lbWFpbCk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpOyAvLyB7IGVtYWlsLCBwbGFuOiB7IGlkLCBuYW1lIH0sIGNhbmNlbF9hdCwgc3RhdHVzIH1cbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUucmVnaXN0ZXJDbG91ZHJvbiA9IGZ1bmN0aW9uIChlbWFpbCwgcGFzc3dvcmQsIHRvdHBUb2tlbiwgc2lnbnVwLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgZGF0YSA9IHtcbiAgICAgICAgICAgIGVtYWlsOiBlbWFpbCxcbiAgICAgICAgICAgIHBhc3N3b3JkOiBwYXNzd29yZCxcbiAgICAgICAgICAgIHNpZ251cDogc2lnbnVwLFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh0b3RwVG9rZW4pIGRhdGEudG90cFRva2VuID0gdG90cFRva2VuO1xuXG4gICAgICAgIHBvc3QoJy9hcGkvdjEvYXBwc3RvcmUvcmVnaXN0ZXJfY2xvdWRyb24nLCBkYXRhLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAxKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIEZpbGVNYW5hZ2VyIEFQSVxuICAgIC8vIG1vZGUgY2FuIGJlICdkb3dubG9hZCcsICdvcGVuJywgJ2xpbmsnIG9yICdkYXRhJ1xuICAgIGZ1bmN0aW9uIGdldE9ianBhdGgoaWQsIHR5cGUpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdtYWlsJykgcmV0dXJuICdtYWlsc2VydmVyJztcbiAgICAgICAgaWYgKHR5cGUgPT09ICdhcHAnKSByZXR1cm4gJ2FwcHMvJyArIGlkO1xuICAgICAgICBpZiAodHlwZSA9PT0gJ3ZvbHVtZScpIHJldHVybiAndm9sdW1lcy8nICsgaWQ7XG4gICAgfVxuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0dldExpbmsgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgpIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSBnZXRPYmpwYXRoKGlkLCB0eXBlKTtcbiAgICAgICAgcmV0dXJuIGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGggKyAnP2Rvd25sb2FkPWZhbHNlJmFjY2Vzc190b2tlbj0nICsgdG9rZW47XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNHZXQgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIG1vZGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gZ2V0T2JqcGF0aChpZCwgdHlwZSk7XG5cbiAgICAgICAgaWYgKG1vZGUgPT09ICdkb3dubG9hZCcpIHtcbiAgICAgICAgICAgIHdpbmRvdy5vcGVuKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGggKyAnP2Rvd25sb2FkPXRydWUmYWNjZXNzX3Rva2VuPScgKyB0b2tlbik7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgICAgfSBlbHNlIGlmIChtb2RlID09PSAnb3BlbicpIHtcbiAgICAgICAgICAgIHdpbmRvdy5vcGVuKGNsaWVudC5hcGlPcmlnaW4gKyAnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGggKyAnP2Rvd25sb2FkPWZhbHNlJmFjY2Vzc190b2tlbj0nICsgdG9rZW4pO1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdW5jdGlvbiByZXNwb25zZUhhbmRsZXIoZGF0YSwgaGVhZGVycywgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGhlYWRlcnMoKVsnY29udGVudC10eXBlJ10gJiYgaGVhZGVycygpWydjb250ZW50LXR5cGUnXS5pbmRleE9mKCdhcHBsaWNhdGlvbi9qc29uJykgIT09IC0xKSByZXR1cm4gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZ2V0KCcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCwgeyB0cmFuc2Zvcm1SZXNwb25zZTogcmVzcG9uc2VIYW5kbGVyIH0sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc1JlbW92ZSA9IGZ1bmN0aW9uIChpZCwgdHlwZSwgcGF0aCwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSBnZXRPYmpwYXRoKGlkLCB0eXBlKTtcblxuICAgICAgICBkZWwoJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLCBudWxsLCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNFeHRyYWN0ID0gZnVuY3Rpb24gKGlkLCB0eXBlLCBwYXRoLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgb2JqcGF0aCA9IGdldE9ianBhdGgoaWQsIHR5cGUpO1xuXG4gICAgICAgIHB1dCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIHsgYWN0aW9uOiAnZXh0cmFjdCcgfSwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0Nob3duID0gZnVuY3Rpb24gKGlkLCB0eXBlLCBwYXRoLCB1aWQsIHJlY3Vyc2l2ZSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSBnZXRPYmpwYXRoKGlkLCB0eXBlKTtcblxuICAgICAgICBwdXQoJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLCB7IGFjdGlvbjogJ2Nob3duJywgdWlkOiB1aWQsIHJlY3Vyc2l2ZTogcmVjdXJzaXZlIH0sIHt9LCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNSZW5hbWUgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIG5ld1BhdGgsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gZ2V0T2JqcGF0aChpZCwgdHlwZSk7XG5cbiAgICAgICAgcHV0KCcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCwgeyBhY3Rpb246ICdyZW5hbWUnLCBuZXdGaWxlUGF0aDogZGVjb2RlVVJJQ29tcG9uZW50KG5ld1BhdGgpIH0sIHt9LCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNDb3B5ID0gZnVuY3Rpb24gKGlkLCB0eXBlLCBwYXRoLCBuZXdQYXRoLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG5cbiAgICAgICAgdmFyIG9ianBhdGggPSBnZXRPYmpwYXRoKGlkLCB0eXBlKTtcblxuICAgICAgICBwdXQoJy9hcGkvdjEvJyArIG9ianBhdGggKyAnL2ZpbGVzLycgKyBwYXRoLCB7IGFjdGlvbjogJ2NvcHknLCBuZXdGaWxlUGF0aDogZGVjb2RlVVJJQ29tcG9uZW50KG5ld1BhdGgpIH0sIHt9LCBmdW5jdGlvbiAoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLnN0YXR1c0NvZGUgPT09IDQwOSkgcmV0dXJuIHRoYXQuZmlsZXNDb3B5KGlkLCB0eXBlLCBwYXRoLCBuZXdQYXRoICsgJy1jb3B5JywgY2FsbGJhY2spO1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIENsaWVudC5wcm90b3R5cGUuZmlsZXNDcmVhdGVEaXJlY3RvcnkgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gZ2V0T2JqcGF0aChpZCwgdHlwZSk7XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIHsgZGlyZWN0b3J5OiBkZWNvZGVVUklDb21wb25lbnQocGF0aCkgfSwge30sIGZ1bmN0aW9uIChlcnJvciwgZGF0YSwgc3RhdHVzKSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICBpZiAoc3RhdHVzICE9PSAyMDApIHJldHVybiBjYWxsYmFjayhuZXcgQ2xpZW50RXJyb3Ioc3RhdHVzLCBkYXRhKSk7XG5cbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgQ2xpZW50LnByb3RvdHlwZS5maWxlc0NyZWF0ZUZpbGUgPSBmdW5jdGlvbiAoaWQsIHR5cGUsIHBhdGgsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBvYmpwYXRoID0gZ2V0T2JqcGF0aChpZCwgdHlwZSk7XG5cbiAgICAgICAgcG9zdCgnL2FwaS92MS8nICsgb2JqcGF0aCArICcvZmlsZXMvJyArIHBhdGgsIHt9LCB7fSwgZnVuY3Rpb24gKGVycm9yLCBkYXRhLCBzdGF0dXMpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgIT09IDIwMCkgcmV0dXJuIGNhbGxiYWNrKG5ldyBDbGllbnRFcnJvcihzdGF0dXMsIGRhdGEpKTtcblxuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBDbGllbnQucHJvdG90eXBlLmZpbGVzVXBsb2FkID0gZnVuY3Rpb24gKGlkLCB0eXBlLCBwYXRoLCBmaWxlLCBvdmVyd3JpdGUsIHByb2dyZXNzSGFuZGxlciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG9ianBhdGggPSBnZXRPYmpwYXRoKGlkLCB0eXBlKTtcblxuICAgICAgICB2YXIgZmQgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgZmQuYXBwZW5kKCdmaWxlJywgZmlsZSk7XG5cbiAgICAgICAgaWYgKG92ZXJ3cml0ZSkgZmQuYXBwZW5kKCdvdmVyd3JpdGUnLCAndHJ1ZScpO1xuXG4gICAgICAgIGZ1bmN0aW9uIGRvbmUoZXJyb3IsIGRhdGEsIHN0YXR1cykge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyAhPT0gMjAwKSByZXR1cm4gY2FsbGJhY2sobmV3IENsaWVudEVycm9yKHN0YXR1cywgZGF0YSkpO1xuXG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkYXRhKTtcbiAgICAgICAgfVxuXG4gICAgICAgICRodHRwKHtcbiAgICAgICAgICAgIHVybDogY2xpZW50LmFwaU9yaWdpbiArICcvYXBpL3YxLycgKyBvYmpwYXRoICsgJy9maWxlcy8nICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogZmQsXG4gICAgICAgICAgICB0cmFuc2Zvcm1SZXF1ZXN0OiBhbmd1bGFyLmlkZW50aXR5LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogJ0JlYXJlciAnICsgdG9rZW5cbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIHVwbG9hZEV2ZW50SGFuZGxlcnM6IHtcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3NIYW5kbGVyKGUubG9hZGVkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLnN1Y2Nlc3MoZGVmYXVsdFN1Y2Nlc3NIYW5kbGVyKGRvbmUpKS5lcnJvcihkZWZhdWx0RXJyb3JIYW5kbGVyKGRvbmUpKTtcbiAgICB9O1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIEV2ZW50bG9nIGhlbHBlcnNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgQ2xpZW50LnByb3RvdHlwZS5ldmVudExvZ0RldGFpbHMgPSBmdW5jdGlvbiAoZXZlbnRMb2csIGFwcElkQ29udGV4dCkge1xuICAgICAgICB2YXIgQUNUSU9OX0FDVElWQVRFID0gJ2Nsb3Vkcm9uLmFjdGl2YXRlJztcbiAgICAgICAgdmFyIEFDVElPTl9QUk9WSVNJT04gPSAnY2xvdWRyb24ucHJvdmlzaW9uJztcbiAgICAgICAgdmFyIEFDVElPTl9SRVNUT1JFID0gJ2Nsb3Vkcm9uLnJlc3RvcmUnO1xuXG4gICAgICAgIHZhciBBQ1RJT05fQVBQX0NMT05FID0gJ2FwcC5jbG9uZSc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX1JFUEFJUiA9ICdhcHAucmVwYWlyJztcbiAgICAgICAgdmFyIEFDVElPTl9BUFBfQ09ORklHVVJFID0gJ2FwcC5jb25maWd1cmUnO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9JTlNUQUxMID0gJ2FwcC5pbnN0YWxsJztcbiAgICAgICAgdmFyIEFDVElPTl9BUFBfUkVTVE9SRSA9ICdhcHAucmVzdG9yZSc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX0lNUE9SVCA9ICdhcHAuaW1wb3J0JztcbiAgICAgICAgdmFyIEFDVElPTl9BUFBfVU5JTlNUQUxMID0gJ2FwcC51bmluc3RhbGwnO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9VUERBVEUgPSAnYXBwLnVwZGF0ZSc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX1VQREFURV9GSU5JU0ggPSAnYXBwLnVwZGF0ZS5maW5pc2gnO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9CQUNLVVAgPSAnYXBwLmJhY2t1cCc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX0JBQ0tVUF9GSU5JU0ggPSAnYXBwLmJhY2t1cC5maW5pc2gnO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9MT0dJTiA9ICdhcHAubG9naW4nO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9PT00gPSAnYXBwLm9vbSc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX1VQID0gJ2FwcC51cCc7XG4gICAgICAgIHZhciBBQ1RJT05fQVBQX0RPV04gPSAnYXBwLmRvd24nO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9TVEFSVCA9ICdhcHAuc3RhcnQnO1xuICAgICAgICB2YXIgQUNUSU9OX0FQUF9TVE9QID0gJ2FwcC5zdG9wJztcbiAgICAgICAgdmFyIEFDVElPTl9BUFBfUkVTVEFSVCA9ICdhcHAucmVzdGFydCc7XG5cbiAgICAgICAgdmFyIEFDVElPTl9CQUNLVVBfRklOSVNIID0gJ2JhY2t1cC5maW5pc2gnO1xuICAgICAgICB2YXIgQUNUSU9OX0JBQ0tVUF9TVEFSVCA9ICdiYWNrdXAuc3RhcnQnO1xuICAgICAgICB2YXIgQUNUSU9OX0JBQ0tVUF9DTEVBTlVQX1NUQVJUID0gJ2JhY2t1cC5jbGVhbnVwLnN0YXJ0JztcbiAgICAgICAgdmFyIEFDVElPTl9CQUNLVVBfQ0xFQU5VUF9GSU5JU0ggPSAnYmFja3VwLmNsZWFudXAuZmluaXNoJztcbiAgICAgICAgdmFyIEFDVElPTl9DRVJUSUZJQ0FURV9ORVcgPSAnY2VydGlmaWNhdGUubmV3JztcbiAgICAgICAgdmFyIEFDVElPTl9DRVJUSUZJQ0FURV9SRU5FV0FMID0gJ2NlcnRpZmljYXRlLnJlbmV3JztcbiAgICAgICAgdmFyIEFDVElPTl9DRVJUSUZJQ0FURV9DTEVBTlVQID0gJ2NlcnRpZmljYXRlLmNsZWFudXAnO1xuXG4gICAgICAgIHZhciBBQ1RJT05fREFTSEJPQVJEX0RPTUFJTl9VUERBVEUgPSAnZGFzaGJvYXJkLmRvbWFpbi51cGRhdGUnO1xuXG4gICAgICAgIHZhciBBQ1RJT05fRE9NQUlOX0FERCA9ICdkb21haW4uYWRkJztcbiAgICAgICAgdmFyIEFDVElPTl9ET01BSU5fVVBEQVRFID0gJ2RvbWFpbi51cGRhdGUnO1xuICAgICAgICB2YXIgQUNUSU9OX0RPTUFJTl9SRU1PVkUgPSAnZG9tYWluLnJlbW92ZSc7XG5cbiAgICAgICAgdmFyIEFDVElPTl9JTlNUQUxMX0ZJTklTSCA9ICdjbG91ZHJvbi5pbnN0YWxsLmZpbmlzaCc7XG5cbiAgICAgICAgdmFyIEFDVElPTl9TVEFSVCA9ICdjbG91ZHJvbi5zdGFydCc7XG4gICAgICAgIHZhciBBQ1RJT05fU0VSVklDRV9DT05GSUdVUkUgPSAnc2VydmljZS5jb25maWd1cmUnO1xuICAgICAgICB2YXIgQUNUSU9OX1NFUlZJQ0VfUkVCVUlMRCA9ICdzZXJ2aWNlLnJlYnVpbGQnO1xuICAgICAgICB2YXIgQUNUSU9OX1NFUlZJQ0VfUkVTVEFSVCA9ICdzZXJ2aWNlLnJlc3RhcnQnO1xuICAgICAgICB2YXIgQUNUSU9OX1VQREFURSA9ICdjbG91ZHJvbi51cGRhdGUnO1xuICAgICAgICB2YXIgQUNUSU9OX1VQREFURV9GSU5JU0ggPSAnY2xvdWRyb24udXBkYXRlLmZpbmlzaCc7XG4gICAgICAgIHZhciBBQ1RJT05fVVNFUl9BREQgPSAndXNlci5hZGQnO1xuICAgICAgICB2YXIgQUNUSU9OX1VTRVJfTE9HSU4gPSAndXNlci5sb2dpbic7XG4gICAgICAgIHZhciBBQ1RJT05fVVNFUl9MT0dPVVQgPSAndXNlci5sb2dvdXQnO1xuICAgICAgICB2YXIgQUNUSU9OX1VTRVJfUkVNT1ZFID0gJ3VzZXIucmVtb3ZlJztcbiAgICAgICAgdmFyIEFDVElPTl9VU0VSX1VQREFURSA9ICd1c2VyLnVwZGF0ZSc7XG4gICAgICAgIHZhciBBQ1RJT05fVVNFUl9UUkFOU0ZFUiA9ICd1c2VyLnRyYW5zZmVyJztcblxuICAgICAgICB2YXIgQUNUSU9OX01BSUxfTE9DQVRJT04gPSAnbWFpbC5sb2NhdGlvbic7XG4gICAgICAgIHZhciBBQ1RJT05fTUFJTF9FTkFCTEVEID0gJ21haWwuZW5hYmxlZCc7XG4gICAgICAgIHZhciBBQ1RJT05fTUFJTF9ESVNBQkxFRCA9ICdtYWlsLmRpc2FibGVkJztcbiAgICAgICAgdmFyIEFDVElPTl9NQUlMX01BSUxCT1hfQUREID0gJ21haWwuYm94LmFkZCc7XG4gICAgICAgIHZhciBBQ1RJT05fTUFJTF9NQUlMQk9YX1VQREFURSA9ICdtYWlsLmJveC51cGRhdGUnO1xuICAgICAgICB2YXIgQUNUSU9OX01BSUxfTUFJTEJPWF9SRU1PVkUgPSAnbWFpbC5ib3gucmVtb3ZlJztcbiAgICAgICAgdmFyIEFDVElPTl9NQUlMX0xJU1RfQUREID0gJ21haWwubGlzdC5hZGQnO1xuICAgICAgICB2YXIgQUNUSU9OX01BSUxfTElTVF9VUERBVEUgPSAnbWFpbC5saXN0LnVwZGF0ZSc7XG4gICAgICAgIHZhciBBQ1RJT05fTUFJTF9MSVNUX1JFTU9WRSA9ICdtYWlsLmxpc3QucmVtb3ZlJztcblxuICAgICAgICB2YXIgQUNUSU9OX1NVUFBPUlRfVElDS0VUID0gJ3N1cHBvcnQudGlja2V0JztcbiAgICAgICAgdmFyIEFDVElPTl9TVVBQT1JUX1NTSCA9ICdzdXBwb3J0LnNzaCc7XG5cbiAgICAgICAgdmFyIEFDVElPTl9WT0xVTUVfQUREID0gJ3ZvbHVtZS5hZGQnO1xuICAgICAgICB2YXIgQUNUSU9OX1ZPTFVNRV9VUERBVEUgPSAndm9sdW1lLnVwZGF0ZSc7XG4gICAgICAgIHZhciBBQ1RJT05fVk9MVU1FX1JFTU9WRSA9ICd2b2x1bWUucmVtb3ZlJztcblxuICAgICAgICB2YXIgQUNUSU9OX0RZTkROU19VUERBVEUgPSAnZHluZG5zLnVwZGF0ZSc7XG5cbiAgICAgICAgdmFyIEFDVElPTl9TWVNURU1fQ1JBU0ggPSAnc3lzdGVtLmNyYXNoJztcblxuICAgICAgICB2YXIgZGF0YSA9IGV2ZW50TG9nLmRhdGE7XG4gICAgICAgIHZhciBlcnJvck1lc3NhZ2UgPSBkYXRhLmVycm9yTWVzc2FnZTtcbiAgICAgICAgdmFyIGRldGFpbHMsIGFwcDtcblxuICAgICAgICBmdW5jdGlvbiBhcHBOYW1lKHByZSwgYXBwLCBkZWZhdWx0VmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChhcHBJZENvbnRleHQpIHJldHVybiBkZWZhdWx0VmFsdWUgfHwgJyc7XG5cbiAgICAgICAgICAgIHByZSA9IHByZSA/IChwcmUgKyAnICcpIDogJyc7XG5cbiAgICAgICAgICAgIHJldHVybiBwcmUgKyAoYXBwLmxhYmVsIHx8IGFwcC5mcWRuIHx8IGFwcC5zdWJkb21haW4pICsgJyAoJyArIGFwcC5tYW5pZmVzdC50aXRsZSArICcpICc7XG4gICAgICAgIH1cblxuICAgICAgICBzd2l0Y2ggKGV2ZW50TG9nLmFjdGlvbikge1xuICAgICAgICBjYXNlIEFDVElPTl9BQ1RJVkFURTpcbiAgICAgICAgICAgIHJldHVybiAnQ2xvdWRyb24gd2FzIGFjdGl2YXRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fUFJPVklTSU9OOlxuICAgICAgICAgICAgcmV0dXJuICdDbG91ZHJvbiB3YXMgc2V0dXAnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX1JFU1RPUkU6XG4gICAgICAgICAgICByZXR1cm4gJ0Nsb3Vkcm9uIHdhcyByZXN0b3JlZCB1c2luZyBiYWNrdXAgYXQgJyArIGRhdGEucmVtb3RlUGF0aDtcblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfQ09ORklHVVJFOiB7XG4gICAgICAgICAgICBpZiAoIWRhdGEuYXBwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICBhcHAgPSBkYXRhLmFwcDtcblxuICAgICAgICAgICAgdmFyIHEgPSBmdW5jdGlvbiAoeCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnXCInICsgeCArICdcIic7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAoJ2FjY2Vzc1Jlc3RyaWN0aW9uJyBpbiBkYXRhKSB7IC8vIHNpbmNlIGl0IGNhbiBiZSBudWxsXG4gICAgICAgICAgICAgICAgcmV0dXJuICdBY2Nlc3MgcmVzdHJpY3Rpb24gJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIGNoYW5nZWQnO1xuICAgICAgICAgICAgfSBlbHNlIGlmICgnb3BlcmF0b3JzJyBpbiBkYXRhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdPcGVyYXRvcnMgJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIGNoYW5nZWQnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdMYWJlbCAnICsgYXBwTmFtZSgnb2YnLCBhcHApICsgJyB3YXMgc2V0IHRvICcgKyBxKGRhdGEubGFiZWwpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLnRhZ3MpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1RhZ3MgJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIHNldCB0byAnICsgcShkYXRhLnRhZ3Muam9pbignLCcpKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5pY29uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdJY29uICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBjaGFuZ2VkJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5tZW1vcnlMaW1pdCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnTWVtb3J5IGxpbWl0ICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBzZXQgdG8gJyArIGRhdGEubWVtb3J5TGltaXQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEuY3B1U2hhcmVzKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdDUFUgc2hhcmVzICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBzZXQgdG8gJyArIE1hdGgucm91bmQoKGRhdGEuY3B1U2hhcmVzICogMTAwKS8xMDI0KSArICclJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5lbnYpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ0VudiB2YXJzICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBjaGFuZ2VkJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoJ2RlYnVnTW9kZScgaW4gZGF0YSkgeyAvLyBzaW5jZSBpdCBjYW4gYmUgbnVsbFxuICAgICAgICAgICAgICAgIGlmIChkYXRhLmRlYnVnTW9kZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXBwTmFtZSgnJywgYXBwLCAnQXBwJykgKyAnIHdhcyBwbGFjZWQgaW4gcmVwYWlyIG1vZGUnO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBhcHAsICdBcHAnKSArICcgd2FzIHRha2VuIG91dCBvZiByZXBhaXIgbW9kZSc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmICgnZW5hYmxlQmFja3VwJyBpbiBkYXRhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdBdXRvbWF0aWMgYmFja3VwcyAnICsgYXBwTmFtZSgnb2YnLCBhcHApICsgJyB3ZXJlICcgKyAoZGF0YS5lbmFibGVCYWNrdXAgPyAnZW5hYmxlZCcgOiAnZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoJ2VuYWJsZUF1dG9tYXRpY1VwZGF0ZScgaW4gZGF0YSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnQXV0b21hdGljIHVwZGF0ZXMgJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2VyZSAnICsgKGRhdGEuZW5hYmxlQXV0b21hdGljVXBkYXRlID8gJ2VuYWJsZWQnIDogJ2Rpc2FibGVkJyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCdyZXZlcnNlUHJveHlDb25maWcnIGluIGRhdGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1JldmVyc2UgcHJveHkgY29uZmlndXJhdGlvbiAnICsgYXBwTmFtZSgnb2YnLCBhcHApICsgJyB3YXMgdXBkYXRlZCc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCdjZXJ0JyBpbiBkYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEuY2VydCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0N1c3RvbSBjZXJ0aWZpY2F0ZSB3YXMgc2V0ICcgKyBhcHBOYW1lKCdmb3InLCBhcHApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnQ2VydGlmaWNhdGUgJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIHJlc2V0JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEuc3ViZG9tYWluKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEuZnFkbiAhPT0gZGF0YS5hcHAuZnFkbikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0xvY2F0aW9uICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBjaGFuZ2VkIHRvICcgKyBkYXRhLmZxZG47XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICghYW5ndWxhci5lcXVhbHMoZGF0YS5yZWRpcmVjdERvbWFpbnMsIGRhdGEuYXBwLnJlZGlyZWN0RG9tYWlucykpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGFsdEZxZG5zID0gZGF0YS5yZWRpcmVjdERvbWFpbnMubWFwKGZ1bmN0aW9uIChhKSB7IHJldHVybiBhLmZxZG47IH0pO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0FsdGVybmF0ZSBkb21haW5zICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyAnICsgKGFsdEZxZG5zLmxlbmd0aCA/ICdzZXQgdG8gJyArIGFsdEZxZG5zLmpvaW4oJywgJykgOiAncmVzZXQnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFhbmd1bGFyLmVxdWFscyhkYXRhLmFsaWFzRG9tYWlucywgZGF0YS5hcHAuYWxpYXNEb21haW5zKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgYWxpYXNEb21haW5zID0gZGF0YS5hbGlhc0RvbWFpbnMubWFwKGZ1bmN0aW9uIChhKSB7IHJldHVybiBhLmZxZG47IH0pO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0FsaWFzIGRvbWFpbnMgJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzICcgKyAoYWxpYXNEb21haW5zLmxlbmd0aCA/ICdzZXQgdG8gJyArIGFsaWFzRG9tYWlucy5qb2luKCcsICcpIDogJ3Jlc2V0Jyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICghYW5ndWxhci5lcXVhbHMoZGF0YS5wb3J0QmluZGluZ3MsIGRhdGEuYXBwLnBvcnRCaW5kaW5ncykpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdQb3J0IGJpbmRpbmdzICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBjaGFuZ2VkJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCdkYXRhRGlyJyBpbiBkYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEuZGF0YURpcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0RhdGEgZGlyZWN0b3J5ICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBzZXQgJyArIGRhdGEuZGF0YURpcjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0RhdGEgZGlyZWN0b3J5ICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyByZXNldCc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmICgnaWNvbicgaW4gZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChkYXRhLmljb24pIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdJY29uICcgKyBhcHBOYW1lKCdvZicsIGFwcCkgKyAnIHdhcyBzZXQnO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnSWNvbiAnICsgYXBwTmFtZSgnb2YnLCBhcHApICsgJyB3YXMgcmVzZXQnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoKCdtYWlsYm94TmFtZScgaW4gZGF0YSkgJiYgZGF0YS5tYWlsYm94TmFtZSAhPT0gZGF0YS5hcHAubWFpbGJveE5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YS5tYWlsYm94TmFtZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ01haWxib3ggJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIHNldCB0byAnICsgcShkYXRhLm1haWxib3hOYW1lKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ01haWxib3ggJyArIGFwcE5hbWUoJ29mJywgYXBwKSArICcgd2FzIHJlc2V0JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBhcHAsICdBcHAnKSArICd3YXMgcmUtY29uZmlndXJlZCc7XG4gICAgICAgIH1cblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfSU5TVEFMTDpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiBkYXRhLmFwcC5tYW5pZmVzdC50aXRsZSArICcgKHBhY2thZ2UgdicgKyBkYXRhLmFwcC5tYW5pZmVzdC52ZXJzaW9uICsgJykgd2FzIGluc3RhbGxlZCAnICsgYXBwTmFtZSgnYXQnLCBkYXRhLmFwcCk7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX1JFU1RPUkU6XG4gICAgICAgICAgICBpZiAoIWRhdGEuYXBwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICBkZXRhaWxzID0gYXBwTmFtZSgnJywgZGF0YS5hcHAsICdBcHAnKSArICcgd2FzIHJlc3RvcmVkJztcbiAgICAgICAgICAgIC8vIG9sZGVyIHZlcnNpb25zICAoPDMuNSkgZGlkIG5vdCBoYXZlIHRoZXNlIGZpZWxkc1xuICAgICAgICAgICAgaWYgKGRhdGEuZnJvbU1hbmlmZXN0KSBkZXRhaWxzICs9ICcgZnJvbSB2ZXJzaW9uICcgKyBkYXRhLmZyb21NYW5pZmVzdC52ZXJzaW9uO1xuICAgICAgICAgICAgaWYgKGRhdGEudG9NYW5pZmVzdCkgZGV0YWlscyArPSAnIHRvIHZlcnNpb24gJyArIGRhdGEudG9NYW5pZmVzdC52ZXJzaW9uO1xuICAgICAgICAgICAgaWYgKGRhdGEucmVtb3RlUGF0aCkgZGV0YWlscyArPSAnIHVzaW5nIGJhY2t1cCBhdCAnICsgZGF0YS5yZW1vdGVQYXRoO1xuICAgICAgICAgICAgcmV0dXJuIGRldGFpbHM7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX0lNUE9SVDpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIGRldGFpbHMgPSBhcHBOYW1lKCcnLCBkYXRhLmFwcCwgJ0FwcCcpICsgJ3dhcyBpbXBvcnRlZCc7XG4gICAgICAgICAgICBpZiAoZGF0YS50b01hbmlmZXN0KSBkZXRhaWxzICs9ICcgdG8gdmVyc2lvbiAnICsgZGF0YS50b01hbmlmZXN0LnZlcnNpb247XG4gICAgICAgICAgICBpZiAoZGF0YS5yZW1vdGVQYXRoKSBkZXRhaWxzICs9ICcgdXNpbmcgYmFja3VwIGF0ICcgKyBkYXRhLnJlbW90ZVBhdGg7XG4gICAgICAgICAgICByZXR1cm4gZGV0YWlscztcblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfVU5JTlNUQUxMOlxuICAgICAgICAgICAgaWYgKCFkYXRhLmFwcCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgcmV0dXJuIGFwcE5hbWUoJycsIGRhdGEuYXBwLCAnQXBwJykgKyAnIChwYWNrYWdlIHYnICsgZGF0YS5hcHAubWFuaWZlc3QudmVyc2lvbiArICcpIHdhcyB1bmluc3RhbGxlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX1VQREFURTpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiAnVXBkYXRlICcgKyBhcHBOYW1lKCdvZicsIGRhdGEuYXBwKSArICcgc3RhcnRlZCBmcm9tIHYnICsgZGF0YS5mcm9tTWFuaWZlc3QudmVyc2lvbiArICcgdG8gdicgKyBkYXRhLnRvTWFuaWZlc3QudmVyc2lvbjtcblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfVVBEQVRFX0ZJTklTSDpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBkYXRhLmFwcCwgJ0FwcCcpICsgJyB3YXMgdXBkYXRlZCB0byB2JyArIGRhdGEuYXBwLm1hbmlmZXN0LnZlcnNpb247XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX0JBQ0tVUDpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiAnQmFja3VwICcgKyBhcHBOYW1lKCdvZicsIGRhdGEuYXBwKSArICcgc3RhcnRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX0JBQ0tVUF9GSU5JU0g6XG4gICAgICAgICAgICBpZiAoIWRhdGEuYXBwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICBpZiAoZGF0YS5lcnJvck1lc3NhZ2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ0JhY2t1cCAnICsgYXBwTmFtZSgnb2YnLCBkYXRhLmFwcCkgKyAnIGZhaWxlZDogJyArIGRhdGEuZXJyb3JNZXNzYWdlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ0JhY2t1cCAnICsgYXBwTmFtZSgnb2YnLCBkYXRhLmFwcCkgKyAnIHN1Y2NlZWRlZCB3aXRoIGJhY2t1cCBpZCAnICsgZGF0YS5iYWNrdXBJZCArICcgYXQgJyArIGRhdGEucmVtb3RlUGF0aDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfQ0xPTkU6XG4gICAgICAgICAgICBpZiAoYXBwSWRDb250ZXh0ID09PSBkYXRhLm9sZEFwcElkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdBcHAgd2FzIGNsb25lZCB0byAnICsgZGF0YS5uZXdBcHAuZnFkbiArICcgdXNpbmcgYmFja3VwIGF0ICcgKyBkYXRhLnJlbW90ZVBhdGg7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGFwcElkQ29udGV4dCA9PT0gZGF0YS5hcHBJZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnQXBwIHdhcyBjbG9uZWQgZnJvbSAnICsgZGF0YS5vbGRBcHAuZnFkbiArICcgdXNpbmcgYmFja3VwIGF0ICcgKyBkYXRhLnJlbW90ZVBhdGg7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBkYXRhLm5ld0FwcCwgJ0FwcCcpICsgJyB3YXMgY2xvbmVkICcgKyBhcHBOYW1lKCdmcm9tJywgZGF0YS5vbGRBcHApICsgJyB1c2luZyBiYWNrdXAgYXQgJyArIGRhdGEucmVtb3RlUGF0aDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfUkVQQUlSOlxuICAgICAgICAgICAgcmV0dXJuIGFwcE5hbWUoJycsIGRhdGEuYXBwLCAnQXBwJykgKyAnIHdhcyByZS1jb25maWd1cmVkJzsgLy8gcmUtY29uZmlndXJlIG9mIGVtYWlsIGFwcHMgaXMgbW9yZSBjb21tb24/XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX0xPR0lOOiB7XG4gICAgICAgICAgICBhcHAgPSB0aGlzLmdldENhY2hlZEFwcFN5bmMoZGF0YS5hcHBJZCk7XG4gICAgICAgICAgICBpZiAoIWFwcCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgcmV0dXJuICdBcHAgJyArIGFwcC5mcWRuICsgJyBsb2dnZWQgaW4nO1xuICAgICAgICB9XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX09PTTpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBkYXRhLmFwcCwgJ0FwcCcpICsgJyByYW4gb3V0IG9mIG1lbW9yeSc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX0RPV046XG4gICAgICAgICAgICBpZiAoIWRhdGEuYXBwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICByZXR1cm4gYXBwTmFtZSgnJywgZGF0YS5hcHAsICdBcHAnKSArICcgaXMgZG93bic7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQVBQX1VQOlxuICAgICAgICAgICAgaWYgKCFkYXRhLmFwcCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgcmV0dXJuIGFwcE5hbWUoJycsIGRhdGEuYXBwLCAnQXBwJykgKyAnIGlzIGJhY2sgb25saW5lJztcblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfU1RBUlQ6XG4gICAgICAgICAgICBpZiAoIWRhdGEuYXBwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICByZXR1cm4gYXBwTmFtZSgnJywgZGF0YS5hcHAsICdBcHAnKSArICcgd2FzIHN0YXJ0ZWQnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX0FQUF9TVE9QOlxuICAgICAgICAgICAgaWYgKCFkYXRhLmFwcCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgcmV0dXJuIGFwcE5hbWUoJycsIGRhdGEuYXBwLCAnQXBwJykgKyAnIHdhcyBzdG9wcGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9BUFBfUkVTVEFSVDpcbiAgICAgICAgICAgIGlmICghZGF0YS5hcHApIHJldHVybiAnJztcbiAgICAgICAgICAgIHJldHVybiBhcHBOYW1lKCcnLCBkYXRhLmFwcCwgJ0FwcCcpICsgJyB3YXMgcmVzdGFydGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9CQUNLVVBfU1RBUlQ6XG4gICAgICAgICAgICByZXR1cm4gJ0JhY2t1cCBzdGFydGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9CQUNLVVBfRklOSVNIOlxuICAgICAgICAgICAgaWYgKCFlcnJvck1lc3NhZ2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ0Nsb3Vkcm9uIGJhY2t1cCBjcmVhdGVkIGF0ICcgKyBkYXRhLnJlbW90ZVBhdGg7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiAnQ2xvdWRyb24gYmFja3VwIGVycm9yZWQgd2l0aCBlcnJvcjogJyArIGVycm9yTWVzc2FnZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICBjYXNlIEFDVElPTl9CQUNLVVBfQ0xFQU5VUF9TVEFSVDpcbiAgICAgICAgICAgIHJldHVybiAnQmFja3VwIGNsZWFuZXIgc3RhcnRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fQkFDS1VQX0NMRUFOVVBfRklOSVNIOlxuICAgICAgICAgICAgcmV0dXJuIGRhdGEuZXJyb3JNZXNzYWdlID8gJ0JhY2t1cCBjbGVhbmVyIGVycm9yZWQ6ICcgKyBkYXRhLmVycm9yTWVzc2FnZSA6ICdCYWNrdXAgY2xlYW5lciByZW1vdmVkICcgKyAoZGF0YS5yZW1vdmVkQm94QmFja3VwUGF0aHMgPyBkYXRhLnJlbW92ZWRCb3hCYWNrdXBQYXRocy5sZW5ndGggOiAnMCcpICsgJyBiYWNrdXBzJztcblxuICAgICAgICBjYXNlIEFDVElPTl9DRVJUSUZJQ0FURV9ORVc6XG4gICAgICAgICAgICByZXR1cm4gJ0NlcnRpZmljYXRlIGluc3RhbGwgZm9yICcgKyBkYXRhLmRvbWFpbiArIChlcnJvck1lc3NhZ2UgPyAnIGZhaWxlZCcgOiAnIHN1Y2NlZWRlZCcpO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX0NFUlRJRklDQVRFX1JFTkVXQUw6XG4gICAgICAgICAgICByZXR1cm4gJ0NlcnRpZmljYXRlIHJlbmV3YWwgZm9yICcgKyBkYXRhLmRvbWFpbiArIChlcnJvck1lc3NhZ2UgPyAnIGZhaWxlZCcgOiAnIHN1Y2NlZWRlZCcpO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX0NFUlRJRklDQVRFX0NMRUFOVVA6XG4gICAgICAgICAgICByZXR1cm4gJ0NlcnRpZmljYXRlKHMpIG9mICcgKyBkYXRhLmRvbWFpbnMuam9pbignLCcpICsgJyB3YXMgY2xlYW5lZCB1cCBzaW5jZSB0aGV5IGV4cGlyZWQgNiBtb250aHMgYWdvJztcblxuICAgICAgICBjYXNlIEFDVElPTl9EQVNIQk9BUkRfRE9NQUlOX1VQREFURTpcbiAgICAgICAgICAgIHJldHVybiAnRGFzaGJvYXJkIGRvbWFpbiBzZXQgdG8gJyArIGRhdGEuZnFkbjtcblxuICAgICAgICBjYXNlIEFDVElPTl9ET01BSU5fQUREOlxuICAgICAgICAgICAgcmV0dXJuICdEb21haW4gJyArIGRhdGEuZG9tYWluICsgJyB3aXRoICcgKyBkYXRhLnByb3ZpZGVyICsgJyBwcm92aWRlciB3YXMgYWRkZWQnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX0RPTUFJTl9VUERBVEU6XG4gICAgICAgICAgICByZXR1cm4gJ0RvbWFpbiAnICsgZGF0YS5kb21haW4gKyAnIHdpdGggJyArIGRhdGEucHJvdmlkZXIgKyAnIHByb3ZpZGVyIHdhcyB1cGRhdGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9ET01BSU5fUkVNT1ZFOlxuICAgICAgICAgICAgcmV0dXJuICdEb21haW4gJyArIGRhdGEuZG9tYWluICsgJyB3YXMgcmVtb3ZlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fSU5TVEFMTF9GSU5JU0g6XG4gICAgICAgICAgICByZXR1cm4gJ0Nsb3Vkcm9uIHZlcnNpb24gJyArIGRhdGEudmVyc2lvbiArICcgaW5zdGFsbGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9NQUlMX0xPQ0FUSU9OOlxuICAgICAgICAgICAgcmV0dXJuICdNYWlsIHNlcnZlciBsb2NhdGlvbiB3YXMgY2hhbmdlZCB0byAnICsgZGF0YS5zdWJkb21haW4gKyAoZGF0YS5zdWJkb21haW4gPyAnLicgOiAnJykgKyBkYXRhLmRvbWFpbjtcblxuICAgICAgICBjYXNlIEFDVElPTl9NQUlMX0VOQUJMRUQ6XG4gICAgICAgICAgICByZXR1cm4gJ01haWwgd2FzIGVuYWJsZWQgZm9yIGRvbWFpbiAnICsgZGF0YS5kb21haW47XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fTUFJTF9ESVNBQkxFRDpcbiAgICAgICAgICAgIHJldHVybiAnTWFpbCB3YXMgZGlzYWJsZWQgZm9yIGRvbWFpbiAnICsgZGF0YS5kb21haW47XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fTUFJTF9NQUlMQk9YX0FERDpcbiAgICAgICAgICAgIHJldHVybiAnTWFpbGJveCAnICsgZGF0YS5uYW1lICsgJ0AnICsgZGF0YS5kb21haW4gKyAnIHdhcyBhZGRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fTUFJTF9NQUlMQk9YX1VQREFURTpcbiAgICAgICAgICAgIGlmIChkYXRhLmFsaWFzZXMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ01haWxib3ggYWxpYXNlcyBvZiAnICsgZGF0YS5uYW1lICsgJ0AnICsgZGF0YS5kb21haW4gKyAnIHdhcyB1cGRhdGVkJztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdNYWlsYm94ICcgKyBkYXRhLm5hbWUgKyAnQCcgKyBkYXRhLmRvbWFpbiArICcgd2FzIHVwZGF0ZWQnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIGNhc2UgQUNUSU9OX01BSUxfTUFJTEJPWF9SRU1PVkU6XG4gICAgICAgICAgICByZXR1cm4gJ01haWxib3ggJyArIGRhdGEubmFtZSArICdAJyArIGRhdGEuZG9tYWluICsgJyB3YXMgcmVtb3ZlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fTUFJTF9MSVNUX0FERDpcbiAgICAgICAgICAgIHJldHVybiAnTWFpbCBsaXN0ICcgKyBkYXRhLm5hbWUgKyAnQCcgKyBkYXRhLmRvbWFpbiArICd3YXMgYWRkZWQnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX01BSUxfTElTVF9VUERBVEU6XG4gICAgICAgICAgICByZXR1cm4gJ01haWwgbGlzdCAnICsgZGF0YS5uYW1lICsgJ0AnICsgZGF0YS5kb21haW4gKyAnIHdhcyB1cGRhdGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9NQUlMX0xJU1RfUkVNT1ZFOlxuICAgICAgICAgICAgcmV0dXJuICdNYWlsIGxpc3QgJyArIGRhdGEubmFtZSArICdAJyArIGRhdGEuZG9tYWluICsgJyB3YXMgcmVtb3ZlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fU1RBUlQ6XG4gICAgICAgICAgICByZXR1cm4gJ0Nsb3Vkcm9uIHN0YXJ0ZWQgd2l0aCB2ZXJzaW9uICcgKyBkYXRhLnZlcnNpb247XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fU0VSVklDRV9DT05GSUdVUkU6XG4gICAgICAgICAgICByZXR1cm4gJ1NlcnZpY2UgJyArIGRhdGEuaWQgKyAnIHdhcyBjb25maWd1cmVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9TRVJWSUNFX1JFQlVJTEQ6XG4gICAgICAgICAgICByZXR1cm4gJ1NlcnZpY2UgJyArIGRhdGEuaWQgKyAnIHdhcyByZWJ1aWx0JztcblxuICAgICAgICBjYXNlIEFDVElPTl9TRVJWSUNFX1JFU1RBUlQ6XG4gICAgICAgICAgICByZXR1cm4gJ1NlcnZpY2UgJyArIGRhdGEuaWQgKyAnIHdhcyByZXN0YXJ0ZWQnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX1VQREFURTpcbiAgICAgICAgICAgIHJldHVybiAnQ2xvdWRyb24gdXBkYXRlIHRvIHZlcnNpb24gJyArIGRhdGEuYm94VXBkYXRlSW5mby52ZXJzaW9uICsgJyB3YXMgc3RhcnRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fVVBEQVRFX0ZJTklTSDpcbiAgICAgICAgICAgIGlmIChkYXRhLmVycm9yTWVzc2FnZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnQ2xvdWRyb24gdXBkYXRlIGVycm9yZWQuIEVycm9yOiAnICsgZGF0YS5lcnJvck1lc3NhZ2U7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiAnQ2xvdWRyb24gdXBkYXRlZCB0byB2ZXJzaW9uICcgKyBkYXRhLm5ld1ZlcnNpb247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fVVNFUl9BREQ6XG4gICAgICAgICAgICByZXR1cm4gZGF0YS5lbWFpbCArIChkYXRhLnVzZXIudXNlcm5hbWUgPyAnICgnICsgZGF0YS51c2VyLnVzZXJuYW1lICsgJyknIDogJycpICsgJyB3YXMgYWRkZWQnO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX1VTRVJfVVBEQVRFOlxuICAgICAgICAgICAgcmV0dXJuIChkYXRhLnVzZXIgPyAoZGF0YS51c2VyLmVtYWlsICsgKGRhdGEudXNlci51c2VybmFtZSA/ICcgKCcgKyBkYXRhLnVzZXIudXNlcm5hbWUgKyAnKScgOiAnJykpIDogZGF0YS51c2VySWQpICsgJyB3YXMgdXBkYXRlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fVVNFUl9SRU1PVkU6XG4gICAgICAgICAgICByZXR1cm4gKGRhdGEudXNlciA/IChkYXRhLnVzZXIuZW1haWwgKyAoZGF0YS51c2VyLnVzZXJuYW1lID8gJyAoJyArIGRhdGEudXNlci51c2VybmFtZSArICcpJyA6ICcnKSkgOiBkYXRhLnVzZXJJZCkgKyAnIHdhcyByZW1vdmVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9VU0VSX1RSQU5TRkVSOlxuICAgICAgICAgICAgcmV0dXJuICdBcHBzIG9mICcgKyBkYXRhLm9sZE93bmVySWQgKyAnIHdhcyB0cmFuc2ZlcnJlZCB0byAnICsgZGF0YS5uZXdPd25lcklkO1xuXG4gICAgICAgIGNhc2UgQUNUSU9OX1VTRVJfTE9HSU46XG4gICAgICAgICAgICByZXR1cm4gKGRhdGEudXNlciA/IGRhdGEudXNlci51c2VybmFtZSA6IGRhdGEudXNlcklkKSArICcgbG9nZ2VkIGluJztcblxuICAgICAgICBjYXNlIEFDVElPTl9VU0VSX0xPR09VVDpcbiAgICAgICAgICAgIHJldHVybiAoZGF0YS51c2VyID8gZGF0YS51c2VyLnVzZXJuYW1lIDogZGF0YS51c2VySWQpICsgJyBsb2dnZWQgb3V0JztcblxuICAgICAgICBjYXNlIEFDVElPTl9EWU5ETlNfVVBEQVRFOiB7XG4gICAgICAgICAgICBkZXRhaWxzID0gJyc7XG4gICAgICAgICAgICBpZiAoZGF0YS5mcm9tSXB2NCAhPT0gZGF0YS50b0lwdjQpIGRldGFpbHMgKz0gJ0ROUyB3YXMgdXBkYXRlZCBmcm9tIElQdjQgJyArIGRhdGEuZnJvbUlwdjQgKyAnIHRvICcgKyBkYXRhLnRvSXB2NCArICcuICc7XG4gICAgICAgICAgICBpZiAoZGF0YS5mcm9tSXB2NiAhPT0gZGF0YS50b0lwdjYpIGRldGFpbHMgKz0gJ0ROUyB3YXMgdXBkYXRlZCBmcm9tIElQdjYgJyArIGRhdGEuZnJvbUlwdjYgKyAnIHRvICcgKyBkYXRhLnRvSXB2NiArICcuJztcbiAgICAgICAgICAgIHJldHVybiBkZXRhaWxzO1xuICAgICAgICB9XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fU1VQUE9SVF9TU0g6XG4gICAgICAgICAgICByZXR1cm4gJ1JlbW90ZSBTdXBwb3J0IHdhcyAnICsgKGRhdGEuZW5hYmxlID8gJ2VuYWJsZWQnIDogJ2Rpc2FibGVkJyk7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fU1VQUE9SVF9USUNLRVQ6XG4gICAgICAgICAgICByZXR1cm4gJ1N1cHBvcnQgdGlja2V0IHdhcyBjcmVhdGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9TWVNURU1fQ1JBU0g6XG4gICAgICAgICAgICByZXR1cm4gJ0Egc3lzdGVtIHByb2Nlc3MgY3Jhc2hlZCc7XG5cbiAgICAgICAgY2FzZSBBQ1RJT05fVk9MVU1FX0FERDpcbiAgICAgICAgICAgIHJldHVybiAnVm9sdW1lIFwiJyArIGRhdGEudm9sdW1lLm5hbWUgKyAnXCIgd2FzIGFkZGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9WT0xVTUVfVVBEQVRFOlxuICAgICAgICAgICAgcmV0dXJuICdWb2xtZSBcIicgKyBkYXRhLnZvbHVtZS5uYW1lICsgJ1wiIHdhcyB1cGRhdGVkJztcblxuICAgICAgICBjYXNlIEFDVElPTl9WT0xVTUVfUkVNT1ZFOlxuICAgICAgICAgICAgcmV0dXJuICdWb2x1bWUgXCInICsgZGF0YS52b2x1bWUubmFtZSArICdcIiB3YXMgcmVtb3ZlZCc7XG5cbiAgICAgICAgZGVmYXVsdDogcmV0dXJuIGV2ZW50TG9nLmFjdGlvbjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIENsaWVudC5wcm90b3R5cGUuZXZlbnRMb2dTb3VyY2UgPSBmdW5jdGlvbiAoZXZlbnRMb2cpIHtcbiAgICAgICAgdmFyIHNvdXJjZSA9IGV2ZW50TG9nLnNvdXJjZTtcbiAgICAgICAgdmFyIGxpbmUgPSAnJztcblxuICAgICAgICBsaW5lID0gc291cmNlLnVzZXJuYW1lIHx8IHNvdXJjZS51c2VySWQgfHwgc291cmNlLm1haWxib3hJZCB8fCBzb3VyY2UuYXV0aFR5cGUgfHwgJ3N5c3RlbSc7XG4gICAgICAgIGlmIChzb3VyY2UuYXBwSWQpIHtcbiAgICAgICAgICAgIHZhciBhcHAgPSB0aGlzLmdldENhY2hlZEFwcFN5bmMoc291cmNlLmFwcElkKTtcbiAgICAgICAgICAgIGxpbmUgKz0gJyAtICcgKyAoYXBwID8gYXBwLmZxZG4gOiBzb3VyY2UuYXBwSWQpO1xuICAgICAgICB9IGVsc2UgaWYgKHNvdXJjZS5pcCkge1xuICAgICAgICAgICAgbGluZSArPSAnIC0gJyArIHNvdXJjZS5pcDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBsaW5lO1xuICAgIH1cblxuXG4gICAgY2xpZW50ID0gbmV3IENsaWVudCgpO1xuICAgIHJldHVybiBjbGllbnQ7XG59XSk7XG4iLCIvKiBUaGlzIGZpbGUgY29udGFpbnMgaGVscGVycyB3aGljaCBzaG91bGQgbm90IGJlIHBhcnQgb2YgY2xpZW50LmpzICovXG5cbmFuZ3VsYXIubW9kdWxlKCdBcHBsaWNhdGlvbicpLmRpcmVjdGl2ZSgncGFzc3dvcmRSZXZlYWwnLCBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHN2Z0V5ZSA9ICc8c3ZnIGFyaWEtaGlkZGVuPVwidHJ1ZVwiIGZvY3VzYWJsZT1cImZhbHNlXCIgZGF0YS1wcmVmaXg9XCJmYXNcIiBkYXRhLWljb249XCJleWVcIiBjbGFzcz1cInN2Zy1pbmxpbmUtLWZhIGZhLWV5ZSBmYS13LTE4XCIgcm9sZT1cImltZ1wiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB2aWV3Qm94PVwiMCAwIDU3NiA1MTJcIj48cGF0aCBmaWxsPVwiY3VycmVudENvbG9yXCIgZD1cIk01NzIuNTIgMjQxLjRDNTE4LjI5IDEzNS41OSA0MTAuOTMgNjQgMjg4IDY0UzU3LjY4IDEzNS42NCAzLjQ4IDI0MS40MWEzMi4zNSAzMi4zNSAwIDAgMCAwIDI5LjE5QzU3LjcxIDM3Ni40MSAxNjUuMDcgNDQ4IDI4OCA0NDhzMjMwLjMyLTcxLjY0IDI4NC41Mi0xNzcuNDFhMzIuMzUgMzIuMzUgMCAwIDAgMC0yOS4xOXpNMjg4IDQwMGExNDQgMTQ0IDAgMSAxIDE0NC0xNDQgMTQzLjkzIDE0My45MyAwIDAgMS0xNDQgMTQ0em0wLTI0MGE5NS4zMSA5NS4zMSAwIDAgMC0yNS4zMSAzLjc5IDQ3Ljg1IDQ3Ljg1IDAgMCAxLTY2LjkgNjYuOUE5NS43OCA5NS43OCAwIDEgMCAyODggMTYwelwiPjwvcGF0aD48L3N2Zz4nO1xuICAgIHZhciBzdmdFeWVTbGFzaCA9ICc8c3ZnIGFyaWEtaGlkZGVuPVwidHJ1ZVwiIGZvY3VzYWJsZT1cImZhbHNlXCIgZGF0YS1wcmVmaXg9XCJmYXNcIiBkYXRhLWljb249XCJleWUtc2xhc2hcIiBjbGFzcz1cInN2Zy1pbmxpbmUtLWZhIGZhLWV5ZS1zbGFzaCBmYS13LTIwXCIgcm9sZT1cImltZ1wiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB2aWV3Qm94PVwiMCAwIDY0MCA1MTJcIj48cGF0aCBmaWxsPVwiY3VycmVudENvbG9yXCIgZD1cIk0zMjAgNDAwYy03NS44NSAwLTEzNy4yNS01OC43MS0xNDIuOS0xMzMuMTFMNzIuMiAxODUuODJjLTEzLjc5IDE3LjMtMjYuNDggMzUuNTktMzYuNzIgNTUuNTlhMzIuMzUgMzIuMzUgMCAwIDAgMCAyOS4xOUM4OS43MSAzNzYuNDEgMTk3LjA3IDQ0OCAzMjAgNDQ4YzI2LjkxIDAgNTIuODctNCA3Ny44OS0xMC40NkwzNDYgMzk3LjM5YTE0NC4xMyAxNDQuMTMgMCAwIDEtMjYgMi42MXptMzEzLjgyIDU4LjFsLTExMC41NS04NS40NGEzMzEuMjUgMzMxLjI1IDAgMCAwIDgxLjI1LTEwMi4wNyAzMi4zNSAzMi4zNSAwIDAgMCAwLTI5LjE5QzU1MC4yOSAxMzUuNTkgNDQyLjkzIDY0IDMyMCA2NGEzMDguMTUgMzA4LjE1IDAgMCAwLTE0Ny4zMiAzNy43TDQ1LjQ2IDMuMzdBMTYgMTYgMCAwIDAgMjMgNi4xOEwzLjM3IDMxLjQ1QTE2IDE2IDAgMCAwIDYuMTggNTMuOWw1ODguMzYgNDU0LjczYTE2IDE2IDAgMCAwIDIyLjQ2LTIuODFsMTkuNjQtMjUuMjdhMTYgMTYgMCAwIDAtMi44Mi0yMi40NXptLTE4My43Mi0xNDJsLTM5LjMtMzAuMzhBOTQuNzUgOTQuNzUgMCAwIDAgNDE2IDI1NmE5NC43NiA5NC43NiAwIDAgMC0xMjEuMzEtOTIuMjFBNDcuNjUgNDcuNjUgMCAwIDEgMzA0IDE5MmE0Ni42NCA0Ni42NCAwIDAgMS0xLjU0IDEwbC03My42MS01Ni44OUExNDIuMzEgMTQyLjMxIDAgMCAxIDMyMCAxMTJhMTQzLjkyIDE0My45MiAwIDAgMSAxNDQgMTQ0YzAgMjEuNjMtNS4yOSA0MS43OS0xMy45IDYwLjExelwiPjwvcGF0aD48L3N2Zz4nO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbGluazogZnVuY3Rpb24gKHNjb3BlLCBlbGVtZW50cykge1xuICAgICAgICAgICAgdmFyIGVsZW1lbnQgPSBlbGVtZW50c1swXTtcblxuICAgICAgICAgICAgaWYgKCFlbGVtZW50LnBhcmVudE5vZGUpICB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignV3JvbmcgcGFzc3dvcmQtcmV2ZWFsIGRpcmVjdGl2ZSB1c2FnZS4gRWxlbWVudCBoYXMgbm8gcGFyZW50LicpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGV5ZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2knKTtcbiAgICAgICAgICAgIGV5ZS5pbm5lckhUTUwgPSBzdmdFeWVTbGFzaDtcbiAgICAgICAgICAgIGV5ZS5zdHlsZS53aWR0aCA9ICcxOHB4JztcbiAgICAgICAgICAgIGV5ZS5zdHlsZS5oZWlnaHQgPSAnMThweCc7XG4gICAgICAgICAgICBleWUuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgICAgICAgICAgZXllLnN0eWxlLmZsb2F0ID0gJ3JpZ2h0JztcbiAgICAgICAgICAgIGV5ZS5zdHlsZS5tYXJnaW5Ub3AgPSAnLTI0cHgnO1xuICAgICAgICAgICAgZXllLnN0eWxlLm1hcmdpblJpZ2h0ID0gJzEwcHgnO1xuICAgICAgICAgICAgZXllLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcblxuICAgICAgICAgICAgZXllLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChlbGVtZW50LnR5cGUgPT09ICdwYXNzd29yZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudC50eXBlID0gJ3RleHQnO1xuICAgICAgICAgICAgICAgICAgICBleWUuaW5uZXJIVE1MID0gc3ZnRXllO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnQudHlwZSA9ICdwYXNzd29yZCc7XG4gICAgICAgICAgICAgICAgICAgIGV5ZS5pbm5lckhUTUwgPSBzdmdFeWVTbGFzaDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZWxlbWVudC5wYXJlbnROb2RlLnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcbiAgICAgICAgICAgIGVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZXllLCBlbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICAgICAgfVxuICAgIH07XG59KTsiXX0=
