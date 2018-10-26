#!/bin/bash
git fetch upstream
git branch -va
git checkout master
git merge upstream/master
git checkout staging
git merge upstream/staging
git add .
git push --all

