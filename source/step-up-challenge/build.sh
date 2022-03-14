#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# usage:
#    build.sh <generate-compressed-module | generate-deployable-zip>
#
# generate-compressed-module : create a compressed module, used for importing in another module as dependency
# generate-deployable-zip    : generate a deployable zip used for lambda deployment
#
# Note: the two cli options are mutually exclusive.
# Note: Change the module_name and module_deps accordingly per project requirement.

## Update following variables as necessary
module_name="step-up-auth-challenge-lambda"
module_deps="auth-utils auth-sdk" # this could list of project in same monorepo separated by spaces


## DO NOT MODIFY
module_build="build"
module_source_root="src" # there are only two supported locations, "src" or "lib"
                         # use "src" when building a deployable lambda
                         # use "lib" when creating a library module
module_test_root="test"
module_dist="${module_build}/dist"
module_zip="${module_build}/compressed"
module_build_js="${module_build}/out"
WORKING_DIR="`pwd`"

## preflight checks
if [ $# -ne 1 ] || [ "$1" != "generate-compressed-module" -a "$1" != "generate-deployable-zip" ]; then
    echo "usage: build.sh <generate-compressed-module | generate-deployable-zip>"
    exit 1
fi


## step 1: show some stats
echo "1 displaying stats"
echo "  WORKING_DIR: ${WORKING_DIR}"

# make sure that the working directory is the root project folder
if [ "${module_source_root}" = "src" ]; then
  if [ ! -f "${WORKING_DIR}/package.json" -o \
      ! -d "${WORKING_DIR}/${module_source_root}" -o \
      ! -d "${WORKING_DIR}/${module_test_root}" ]; then
    echo "unable to locate required files and folders. missing one of the following:"
    echo "    ${WORKING_DIR}/package.json"
    echo "    ${WORKING_DIR}/${module_source_root}"
    echo "    ${WORKING_DIR}/${module_test_root}"
    exit 1
  fi
elif [ "${module_source_root}" = "lib" ]; then
  if [ ! -f "${WORKING_DIR}/package.json" -o \
      ! -f "${WORKING_DIR}/index.ts" -o \
      ! -d "${WORKING_DIR}/${module_source_root}" -o \
      ! -d "${WORKING_DIR}/${module_test_root}" ]; then
    echo "unable to locate required files and folders. missing one of the following:"
    echo "    ${WORKING_DIR}/package.json"
    echo "    ${WORKING_DIR}/index.ts"
    echo "    ${WORKING_DIR}/${module_source_root}"
    echo "    ${WORKING_DIR}/${module_test_root}"
    exit 1
  fi
else
  echo "unsupported module_source_root: ${module_source_root}"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "warning: run 'npm install' before running the build to ensure local build is successful"
  echo "warning: run 'npm link <dep modules>' after npm install to maintain local dev env"
  exit 2
fi


## step 2: re-initialize build folders and installation
echo "2 initializing"

# clean up build and module_dist
rm -rf "${module_build}"
mkdir -p "${module_build}"
mkdir -p "${module_dist}"
mkdir -p "${module_zip}"
mkdir -p "${module_build_js}"

# copy package.json before alteration
cd "${WORKING_DIR}"
cp package.json "${module_dist}" > /tmp/$$.cp.log 2>&1
if [ $? -ne 0 ]; then
  echo "cp failed: $?"
  echo "cp logs:"
  cat /tmp/$$.tar.log
  rm -rf /tmp/$$.*
  exit 2
fi

## step 3: verify tsc installation
echo "3 verifying tsc compiler"

# check tsc is installed
(
  tsc --version > /tmp/$$.tsc.1.log 2>&1
  if [ $? -ne 0 ]; then
    echo "typescript compiler, tsc, is not installed: $?"

    echo "installing tsc"
    npm install -g typescript > /tmp/$$.tsc-npm-install.log 2>&1
    if [ $? -ne 0 ]; then
      echo "npm install tsc failed: $?"
      echo "npm install tsc logs:"
      cat /tmp/$$.tsc-npm-install.log
      rm -rf /tmp/$$.*
      exit 2
    fi
  fi
)
if [ $? -ne 0 ]; then
  exit 2
fi

# verify tsc installation
(
  tsc --version > /tmp/$$.tsc.2.log 2>&1
  if [ $? -ne 0 ]; then
    echo "unable to verify tsc installation: $?"
    echo "tsc error logs:"
    cat /tmp/$$.tsc.2.log
    rm -rf /tmp/$$.*
    exit 2
  fi
)
if [ $? -ne 0 ]; then
  exit 2
fi


## step 4: build and copy all module dependencies
echo "4 building module dependencies"

if [ ! "$module_deps" = "" ]; then
  for module_dep in ${module_deps}; do
    echo "  $module_dep"
    (
      # build module dependency
      cd "${WORKING_DIR}/../${module_dep}"
      if [ ! -f ./build.sh ]; then
        echo "unable to load ${module_dep}/build.sh"
        rm -rf /tmp/$$.*
        exit 3
      fi
      ./build.sh "generate-compressed-module" > "/tmp/$$.${module_dep}-build.log" 2>&1
      if [ $? -ne 0 ]; then
        echo "${module_dep} build failed: $?"
        echo "${module_dep} build logs:"
        cat "/tmp/$$.${module_dep}-build.log"
        rm -rf /tmp/$$.*
        exit 2
      fi

      # copy built module dependency into home module_zip
      cp "${module_zip}"/* "${WORKING_DIR}/${module_zip}" > "/tmp/$$.${module_dep}-cp.log" 2>&1
      if [ $? -ne 0 ]; then
        echo "copy failed: $?"
        echo "copy logs:"
        cat "/tmp/$$.${module_dep}-cp.log"
        rm -rf /tmp/$$.*
        exit 2
      fi
    )
    if [ $? -ne 0 ]; then
      exit 2
    fi
  done
  if [ $? -ne 0 ]; then
    exit 2
  fi
fi


## step 5: build the source code (transpile from TypeScript to ES6)
echo "5 transpiling source"
# transpile code
(
  npm run build-ts-prod > /tmp/$$.npm1.log 2>&1
  if [ $? -ne 0 ]; then
    echo "transpilation failed: $?"
    echo "transpilation logs:"
    cat /tmp/$$.npm1.log
    rm -rf /tmp/$$.*
    exit 2
  fi
)


## step 6: copy module transpiled source into module_dist and run npm install in module_dist
module_tgzs="`ls ${module_zip}`"
echo "6 copying transpiled source to ${module_dist}"
(
  cd "${WORKING_DIR}/${module_build_js}"

  # $module_build_js into the root of $module_dist
  tar cf - . | (cd "${WORKING_DIR}/${module_dist}"; tar xf - ) > "/tmp/$$.tar-${module_source_root}.log" 2>&1
  if [ $? -ne 0 ]; then
    echo "tar failed: $?"
    echo "tar logs:"
    cat "/tmp/$$.tar-${module_source_root}.log"
    rm -rf /tmp/$$.*
    exit 2
  fi

  # install compressed deps into dist folder
  if [ ! "$module_tgzs" = "" ]; then
    for module_tgz in ${module_tgzs}; do
      (
        cd "${WORKING_DIR}/${module_dist}"
        npm install --production "${WORKING_DIR}/${module_zip}/${module_tgz}" > "/tmp/$$.${module_tgz}-npm-install.log" 2>&1
        if [ $? -ne 0 ]; then
          echo "npm install failed for ${module_tgz}: $?"
          echo "npm install logs:"
          cat "/tmp/$$.${module_tgz}-npm-install.log"
          rm -rf /tmp/$$.*
          exit 2
        fi
      )
      if [ $? -ne 0 ]; then
        exit 2
      fi
    done
    if [ $? -ne 0 ]; then
      exit 2
    fi
  fi

  # change to dist folder and start the npm build
  cd "${WORKING_DIR}/${module_dist}"
  npm install --production > /tmp/$$.npm-install-1.log 2>&1
  if [ $? -ne 0 ]; then
      echo "npm install failed: $?"
      echo "npm install logs:"
      cat /tmp/$$.npm-install-1.log
      rm -rf /tmp/$$.*
      exit 3
  fi
)
if [ $? -ne 0 ]; then
  exit 2
fi


## step 7: generate compressed module
if [ $# -eq 1 -a "$1" == "generate-compressed-module" ]; then
  echo "7 generating compressed module"

  (
    # echo "${WORKING_DIR}/${module_dist}"
    cd "${WORKING_DIR}/${module_dist}"
    npm pack > /tmp/$$.npm-pack.log 2>&1
    if [ $? -ne 0 ]; then
      echo "npm pack failed: $?"
      echo "npm pack logs:"
      cat /tmp/$$.npm-pack.log
      rm -rf /tmp/$$.*
      exit 2
    fi
  )
  if [ $? -ne 0 ]; then
    exit 2
  fi

  # move built module to module_zip folder
  echo "  moving built module to ${WORKING_DIR}/${module_zip}"

  export module_tgz=`ls "${WORKING_DIR}/${module_dist}"/*tgz`
  if [ "${module_tgz}" = "" ]; then
    echo "unable to find built module with .tgz extension"
    exit 3
  fi

  (
    mv "${module_tgz}" "${WORKING_DIR}/${module_zip}" > /tmp/$$.mv.log 2>&1
    if [ $? -ne 0 ]; then
      echo "mv failed: $?"
      echo "mv logs:"
      cat /tmp/$$.mv.log
      rm -rf /tmp/$$.*
      exit 2
    fi
  )
  if [ $? -ne 0 ]; then
    exit 2
  fi
else
  echo "7 [skipped] generating compressed module"
fi


## step 8: generate deployable zip
if [ $# -eq 1 -a "$1" == "generate-deployable-zip" ]; then
  echo "8 generating deployable zip"

  (
    # echo "${WORKING_DIR}/${module_dist}"
    cd "${WORKING_DIR}/${module_dist}"
    zip -9r "${WORKING_DIR}/${module_zip}/${module_name}.zip" . > /tmp/$$.zip.log 2>&1
    if [ $? -ne 0 ]; then
      echo "zip failed: $?"
      echo "zip logs:"
      cat /tmp/$$.zip.log
      rm -rf /tmp/$$.*
      exit 2
    fi
  )
  if [ $? -ne 0 ]; then
    exit 2
  fi
else
  echo "8 [skipped] generating deployable zip"
fi


## step 9: clean up
rm -rf /tmp/$$.*
echo "done"
